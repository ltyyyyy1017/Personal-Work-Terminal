import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { extractTextItems, getDocumentProxy, renderPageAsImage } from "unpdf";
import { isPdfBytes } from "./pdf";
import { parseMaterialText, type RecognizedDocument } from "./reimbursement-recognition";
import { decodePlainText } from "./plain-text";
import { layoutLines, invoiceColumnText,itineraryTableText } from "./material-layout";
import {pdfOptions} from "./pdf-options";
import {readDocumentMaterial} from "./document-material";
import {rapidConfigured,rapidRecognize,readLegacyExcel} from "./rapid-ocr";

// Keep binary model and worker lookup in Node; bundling traineddata as JS breaks OCR.
const requireFromProject = process.getBuiltinModule("module").createRequire(path.join(process.cwd(), "package.json"));
const g = globalThis as unknown as { __wbOcr?: { worker?: Promise<Worker>; tail: Promise<unknown>; pending: number; idle?: ReturnType<typeof setTimeout> } };
function state() { return g.__wbOcr ??= { tail: Promise.resolve(), pending: 0 }; }
async function worker() {
  const s = state();
  s.worker ??= (async () => {
    const langPath = process.getBuiltinModule("path").join(os.tmpdir(), "workbench-ocr-models-v1"); fs.mkdirSync(langPath, { recursive: true });
    for (const code of ["chi_sim", "chi_tra", "eng"]) {
      const target = path.join(langPath, `${code}.traineddata.gz`);
      if (!fs.existsSync(target)) { const tmp = `${target}.${process.pid}.tmp`; fs.copyFileSync(requireFromProject.resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`), tmp); fs.renameSync(tmp, target); }
    }
    const w = await createWorker("chi_sim+chi_tra+eng", 1, { langPath, workerPath: requireFromProject.resolve("tesseract.js/src/worker-script/node/index.js"), cacheMethod: "none", errorHandler: () => {} });
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
    return w;
  })().catch(e => { s.worker = undefined; throw e; });
  return s.worker;
}
async function ocr(bytes: Buffer) {
  const s = state(); if (s.pending >= 5) throw new Error("识别任务较多，请稍后重试此附件");
  s.pending++; clearTimeout(s.idle);
  const task = s.tail.catch(() => {}).then(async () => {
    const image = await sharp(bytes, { limitInputPixels: 30_000_000 }).rotate().flatten({ background: "#fff" }).resize({ width: 1900, height: 2800, fit: "inside", withoutEnlargement: false }).normalize().png().toBuffer();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const w = await worker();
      return await Promise.race([w.recognize(image), new Promise<never>((_, reject) => { timeout = setTimeout(() => { void w.terminate(); s.worker = undefined; reject(new Error("本次图片识别超时，可以重试或换一张更清晰的图片")); }, 55_000); })]);
    } finally { clearTimeout(timeout); }
  });
  s.tail = task;
  try { return await task; }
  finally {
    s.pending--;
    if (!s.pending) { s.idle = setTimeout(() => { const p = s.worker; s.worker = undefined; void p?.then(w => w.terminate()).catch(() => {}); }, 30_000); s.idle.unref?.(); }
  }
}
export async function readMaterial(bytes: Buffer, name: string, id: string): Promise<RecognizedDocument> {
  const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex"), warnings: string[] = [];
  let text = "", pages: number | undefined, method: RecognizedDocument["method"] = "pdf-text", confidence = 1,engine:string|undefined;
  const imageText=async(image:Buffer)=>{
    if(rapidConfigured())try{const result=await rapidRecognize(image);engine=result.engine;const cells=result.cells||[];const parties=invoiceColumnText(cells),trip=itineraryTableText(cells);return {text:[parties,trip,layoutLines(cells)].filter(Boolean).join("\n"),confidence:result.confidence||0};}catch{warnings.push("中文 OCR 本次未能完成，已使用備用引擎；請核對結果。");}
    const result=await ocr(image);engine="Tesseract";return {text:result.data.text,confidence:result.data.confidence/100};
  };
  const pageTexts: string[] = [];
  let complete = true;
  try {
    if (/\.(txt|md|csv|json|xml|ofd|docx?|xlsx)$/i.test(name)) {
      method = "plain-text";const document=await readDocumentMaterial(bytes,name);text=document.cells?[invoiceColumnText(document.cells),itineraryTableText(document.cells),document.text].filter(Boolean).join("\n"):document.text;
    } else if(/\.xls$/i.test(name)){
      method="plain-text";const result=await readLegacyExcel(bytes);text=result.text||"";engine=result.engine;
    } else if (isPdfBytes(bytes)) {
      const proxy = await getDocumentProxy(new Uint8Array(bytes),pdfOptions());
      try {
        pages = proxy.numPages;
        if (pages > 20) throw new Error("此 PDF 超过 20 页，请拆分后再识别");
        const content = await extractTextItems(proxy);
        let scanned = 0;
        for (const [i, items] of content.items.entries()) {
          const columns = invoiceColumnText(items),trip=itineraryTableText(items);
          const pageText = [columns,trip,layoutLines(items)].filter(Boolean).join("\n");
          if (pageText.replace(/\s/g, "").length >= 25) { text += `${pageText}\n`; pageTexts.push(pageText); continue; }
          if (++scanned > 3) { complete = false; warnings.push("扫描 PDF 仅自动识别前三个扫描页，其余页面请拆分后补充识别；本附件未自动填写整份金额。"); break; }
          const page = await proxy.getPage(i + 1), viewport = page.getViewport({ scale: 1 });
          if (!(viewport.width > 0 && viewport.height > 0)) throw new Error("PDF 页面尺寸异常，请重新导出文件");
          const scale = Math.min(1900 / viewport.width, 2800 / viewport.height, 4);
          const image = await renderPageAsImage(proxy, i + 1, { canvasImport: () => import("@napi-rs/canvas"), scale });
          const result = await imageText(Buffer.from(image as ArrayBuffer)); text += `${result.text}\n`; pageTexts.push(result.text); method = "ocr"; confidence = Math.min(confidence, result.confidence);
        }
      } finally { await proxy.loadingTask.destroy(); }
    } else {
      const result = await imageText(bytes); text = result.text; confidence = result.confidence; method = "ocr";
    }
    if (!text.trim()) { method = "unreadable"; warnings.push("没有读到可用文字，可以换清晰附件重试；无法识别的字段仍可手动补充。"); }
    if (method === "ocr" && confidence < .7) warnings.push("图片文字部分不清晰，自动填写的信息请重点核对。");
  } catch (e) { complete = false; method = "unreadable"; warnings.push((e as Error).message || "附件暂时无法识别，请更换文件或手动补充"); }
  const doc = parseMaterialText(text, { id, name, fingerprint, method, confidence, pages });
  const invoicePages = pageTexts.map(t => parseMaterialText(t, { id, name, fingerprint, method, confidence })).filter(d => d.kind === "发票" && d.fields.invoiceNo);
  const uniquePages = [...new Map(invoicePages.map(d => [d.fields.invoiceNo, d])).values()];
  const allNumbers = [...new Set([...text.replace(/\s/g, "").matchAll(/(?:发票|發票)(?:号码|號碼)[:：]?(\d{8,20})/g)].map(m => m[1]))];
  if (uniquePages.length > 1) {
    const values = (key: keyof RecognizedDocument["fields"]) => [...new Set(uniquePages.map(d => d.fields[key]).filter(Boolean))];
    doc.fields.invoiceNo = uniquePages.map(d => d.fields.invoiceNo).join("、"); doc.meta.invoiceNo = doc.fields.invoiceNo;
    if (uniquePages.every(d => Number(d.fields.amount) > 0) && values("currency").length <= 1) {
      doc.fields.amount = (uniquePages.reduce((n,d) => n + Math.round(Number(d.fields.amount) * 100), 0) / 100).toFixed(2); doc.meta.amount = Number(doc.fields.amount);
    } else { delete doc.fields.amount; doc.meta.amount = null; warnings.push("多页发票的部分金额或币种需要核对，未直接合计。"); }
    for (const key of ["buyer", "taxId", "currency", "date"] as const) {
      const found = values(key);
      if (found.length === 1) doc.fields[key] = found[0];
      else if (found.length > 1) { delete doc.fields[key]; warnings.push(`多页发票的${key === "buyer" ? "抬头" : key === "taxId" ? "税号" : key === "date" ? "日期" : "币种"}不同，请核对本次报销范围。`); }
    }
    doc.fields.item = values("item").join("、").slice(0,160) || doc.fields.item;
    doc.meta.buyerName = doc.fields.buyer; doc.meta.buyerTaxId = doc.fields.taxId;
  } else if (allNumbers.length > 1) {
    doc.fields.invoiceNo = allNumbers.join("、"); doc.meta.invoiceNo = doc.fields.invoiceNo;
    delete doc.fields.amount; doc.meta.amount = null;
    warnings.push("同一页包含多张不同发票，请核对合计金额；未把第一张发票金额当作整份附件金额。");
  }
  if (!complete) { delete doc.fields.amount; doc.meta.amount = null; }
  return { ...doc,engine, warnings: [...doc.warnings, ...warnings] };
}
