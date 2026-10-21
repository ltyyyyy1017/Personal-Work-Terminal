import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { ReimbActivity, ReimbOutput } from "./types";
import { appendLog, dirs, mutateStore, readStore } from "./store";
import { readReimburseFile } from "./files";
import { mergePdfs, normalizeToPdf } from "./pdf";
import { namingPlan, sanitizeFileBase } from "./naming";
import { buildReimburseWorkbook } from "./excel";
import { analyzeActivity, type CheckItem } from "./checks";
import { AppError } from "./errors";
import { fmtDateFull, toDateStr } from "./date";
import {organizationSettings} from "./organizations";
import {isReported,isFunded} from "./reimbursement-progress";

export interface BuildResult {
  activity: ReimbActivity;
  output: ReimbOutput;
  checks: CheckItem[];
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  let i = 2;
  while (used.has(`${base}(${i})${ext}`)) i++;
  const next = `${base}(${i})${ext}`;
  used.add(next);
  return next;
}

/** 打包：重命名 → 转 PDF → Excel → ZIP，并写回活动状态 */
export async function buildActivity(activityId: string): Promise<BuildResult> {
  const store = readStore();
  const activity = store.activities.find((a) => a.id === activityId);
  if (!activity) throw new AppError("报销活动不存在", 404);
  if (!activity.items.length) throw new AppError("请先添加报销事项（名称 + 金额）", 400);
  if (!activity.files.length) throw new AppError("请先上传报销材料", 400);

  const settings = organizationSettings(store.settings,activity.department);
  const plan = namingPlan(activity, settings.reimbursement.namingTemplate);
  if (!plan.length) throw new AppError("没有可打包的材料", 400);

  const checks = analyzeActivity(activity, settings);
  const outDir = path.join(dirs.exports, activity.id, stamp());
  fs.mkdirSync(outDir, { recursive: true });

  const manifest: ReimbOutput["manifest"] = [];
  const used = new Set<string>();
  const pdfList: Uint8Array[] = [];
  const failed: string[] = [];

  for (const row of plan) {
    const file = activity.files.find((f) => f.id === row.fileId);
    if (!file) continue;
    try {
      const buf = readReimburseFile(file.storedName);
      const plainText = /\.txt$/i.test(file.originalName);
      const { bytes } = plainText ? { bytes: buf } : await normalizeToPdf(buf, file.mime, file.originalName);
      const name = uniqueName(row.name, used);
      fs.writeFileSync(path.join(outDir, name), bytes);
      manifest.push({ name, size: bytes.byteLength, kind: file.kind });
      if (!plainText) pdfList.push(bytes);
    } catch (err) {
      failed.push(`${file.originalName}（${(err as Error).message}）`);
    }
  }

  if (!manifest.length) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new AppError(`所有材料都无法转换：${failed.join("；")}`, 422);
  }

  let mergedName: string | null = null;
  if (settings.reimbursement.mergeAll && pdfList.length > 1) {
    try {
      const merged = await mergePdfs(pdfList);
      mergedName = uniqueName("00-全部材料合并.pdf", used);
      fs.writeFileSync(path.join(outDir, mergedName), merged);
      manifest.push({ name: mergedName, size: merged.byteLength, kind: "合并件" });
    } catch (err) {
      failed.push(`合并 PDF 失败：${(err as Error).message}`);
    }
  }

  const { buffer: xlsx, total } = await buildReimburseWorkbook({
    matterTitle:store.matters.find(m=>m.id===activity.matterId)?.title,
    activity,
    settings,
    plan,
  });
  const xlsxName = uniqueName("报销明细表.xlsx", used);
  fs.writeFileSync(path.join(outDir, xlsxName), xlsx);

  const readme = [
    `${settings.org || "示例组织一"} · ${activity.name}`,
    `报销部门：${activity.department}    报销人：${activity.submitter || "待补充"}`,
    `经办人：${activity.handler || "未填写"}`,
    "TXT 补充材料按原格式保留，不参与 PDF 合并。",
    `报销日期：${fmtDateFull(activity.date)}`,
    `关联事务：${store.matters.find(m=>m.id===activity.matterId)?.title||"未关联"}`,
    `进度：${isReported(activity)?"已上报":"未上报"} · ${isFunded(activity)?"已批款":"未批款"}`,
    ...(activity.taxi?[`打车行程：${activity.taxi.from||"未填写"} → ${activity.taxi.to||"未填写"}`,`同行人：${activity.taxi.companions.join("、")||"无 / 未填写"}`]:[]),
    `金额合计：¥${total.toFixed(2)}（${activity.items.length} 个事项 / ${activity.files.length} 份材料）`,
    ...(activity.currency&&activity.currency!=="CNY"?[`原币实付：${activity.currency} ${activity.paidAmount?.toFixed(2)??"未填写"}；材料命名与报销明细金额为人民币结算金额。`]:[]),
    "",
    "材料清单：",
    ...plan.map((p, i) => `${String(i + 1).padStart(2, "0")}. ${p.seq}  ${p.name}  [${p.kind}]`),
    "",
    `打包时间：${new Date().toLocaleString("zh-CN")}`,
    `由「个人工作台」生成 · 文件名与报销明细表一一对应`,
  ].join("\r\n");
  const readmeName = "材料清单.txt";
  fs.writeFileSync(path.join(outDir, readmeName), readme, "utf8");

  const zip = new JSZip();
  const folder = zip.folder(`${sanitizeFileBase(activity.name)}_报销材料`)!;
  for (const m of manifest) {
    folder.file(m.name, fs.readFileSync(path.join(outDir, m.name)));
  }
  folder.file(xlsxName, xlsx);
  folder.file(readmeName, readme);
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const zipName = `${sanitizeFileBase(activity.name)}_报销材料_${toDateStr(new Date()).replace(/-/g, "")}.zip`;
  fs.writeFileSync(path.join(outDir, zipName), zipBuffer);

  const output: ReimbOutput = {
    builtAt: new Date().toISOString(),
    dir: path.relative(dirs.root, outDir).split(path.sep).join("/"),
    zipName,
    xlsxName,
    mergedName,
    totalAmount: total,
    fileCount: manifest.length,
    manifest,
    warnings: [...checks.filter((c) => c.level === "error" || c.level === "warn").map((c) => c.title), ...failed],
  };

  let updated!: ReimbActivity;
  const { store: next } = await mutateStore((s) => {
    const target = s.activities.find((a) => a.id === activityId);
    if (!target) throw new AppError("报销活动不存在", 404);
    target.output = output;
    target.updatedAt = new Date().toISOString();
    if (target.status === "draft") target.status = "packaged";
    appendLog(
      s,
      "reimburse",
      `打包《${target.name}》：${manifest.length} 份材料，合计 ¥${total.toFixed(2)}`,
    );
    updated = target;
  });

  void next;
  return { activity: updated, output, checks };
}
