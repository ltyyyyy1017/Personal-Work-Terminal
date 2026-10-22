"use client";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload, FileText, X, Check, ChevronLeft, LoaderCircle, RefreshCw, AlertCircle, Sparkles, ShieldCheck, Files, Pencil, ChevronDown } from "lucide-react";
import { useDepartments, useDepartmentLabel } from "./department-context";
import ReimbursementFields, { reimbursementValue, reimbursementBody, type ReimbursementFieldsValue } from "./reimbursement-fields";
import {MATERIAL_ACCEPT,MATERIAL_FORMAT_LABEL,supportedMaterial,textMaterial} from "@/lib/reimbursement-formats";
import { MAT_KINDS } from "@/lib/constants";
import { todayStr } from "@/lib/date";
import { organizationSettings } from "@/lib/organizations";
import { summarizeRecognition, recognitionLabels, type RecognizedDocument, type RecognitionField } from "@/lib/reimbursement-recognition";
import type { Department, Settings, Matter, MatKind } from "@/lib/types";

interface Entry { id: string; file: File; status: "pending" | "reading" | "done" | "failed"; result?: RecognizedDocument; kind?: MatKind; error?: string; edited?: boolean }
const LIMIT = 15 * 1024 * 1024, TOTAL = 25 * 1024 * 1024;
const billingKey = (s: string) => s.normalize("NFKC").replace(/\s/g, "").toUpperCase();
export default function ReimbursementUpload({ settings, matters = [], defaultDepartment = "行政部", onBack, onSaved }: {
  settings: Settings; matters?: Matter[]; defaultDepartment?: Department; onBack: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const departments = useDepartments(), departmentLabel = useDepartmentLabel();
  const [department, setDepartment] = useState<Department>(defaultDepartment), [entries, setEntries] = useState<Entry[]>([]);
  const [manual, setManual] = useState<Partial<Record<RecognitionField, string>>>({}), [extra, setExtra] = useState(reimbursementValue());
  const [taxiOverride, setTaxiOverride] = useState<boolean | null>(null), [confirmed, setConfirmed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [matterOverride, setMatterOverride] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; itemId: string } | null>(null), [epoch, setEpoch] = useState(0), [dragging, setDragging] = useState(false);
  const processing = useRef(false), controller = useRef<AbortController | null>(null), mounted = useRef(true);
  const savedFiles = useRef(new Map<string, { fileId: string; complete: boolean }>());
  const expected = organizationSettings(settings, department).reimbursement;
  const docs = useMemo(() => entries.flatMap(e => e.result ? [{ ...e.result, kind: e.kind || e.result.kind }] : []), [entries]);
  const summary = useMemo(() => summarizeRecognition(docs), [docs]);
  const defaults: Partial<Record<RecognitionField, string>> = { handler: settings.name || "", currency: "CNY" };
  const value = (key: RecognitionField) => manual[key] ?? summary.fields[key]?.value ?? (summary.conflicts.some(c => c.field === key) ? "" : defaults[key]) ?? "";
  const change = (key: RecognitionField, next: string) => { setManual(v => ({ ...v, [key]: next })); setConfirmed(false); };
  const restore = (key: RecognitionField) => { setManual(v => { const copy = { ...v }; delete copy[key]; return copy; }); setConfirmed(false); };
  const reading = entries.some(e => e.status === "reading" || e.status === "pending"), done = entries.filter(e => e.status === "done").length;
  const uniqueEntries = entries.filter(e => !summary.duplicates[e.id]);
  const invoiceEntries = uniqueEntries.filter(e => (e.kind || e.result?.kind) === "发票");
  const matchingMatters = matters.filter(m => m.department === department && m.title.length >= 4 && docs.some(d => d.textPreview.includes(m.title)));
  const extraValue: ReimbursementFieldsValue = { ...extra, matterId: matterOverride ?? (matchingMatters.length === 1 ? matchingMatters[0].id : extra.matterId),
    taxiEnabled: taxiOverride ?? summary.taxi, from: value("from"), to: value("to"), companions: value("companions") };
  const titleMatch = !expected.invoiceTitle || !value("buyer") || billingKey(value("buyer")) === billingKey(expected.invoiceTitle);
  const taxMatch = !expected.taxId || !value("taxId") || billingKey(value("taxId")) === billingKey(expected.taxId);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (processing.current || saving) return;
    const entry = entries.find(e => e.status === "pending"); if (!entry) return;
    processing.current = true; const abort = new AbortController(); controller.current = abort;
    setEntries(list => list.map(e => e.id === entry.id ? { ...e, status: "reading" } : e));
    void (async () => {
      try {
        const body = new FormData(); body.append("files", entry.file); body.append("ids", entry.id);
        const response = await fetch("/api/reimbursement/preview", { method: "POST", body, signal: abort.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "识别暂时失败，请重试");
        const result = data.results[0] as RecognizedDocument;
        if (mounted.current) setEntries(list => list.map(e => e.id === entry.id ? { ...e, result, status: result.method === "unreadable" ? "failed" : "done", error: result.method === "unreadable" ? result.warnings.join("；") : undefined } : e));
      } catch (e) {
        if (mounted.current && !abort.signal.aborted) setEntries(list => list.map(v => v.id === entry.id ? { ...v, status: "failed", error: (e as Error).message } : v));
      } finally { processing.current = false; if (mounted.current) setEpoch(v => v + 1); }
    })();
  }, [entries, epoch, saving]);

  function add(incoming: FileList | File[] | null) {
    if (!incoming || draft) return;
    const files = Array.from(incoming), all = [...entries.map(e => e.file), ...files];
    if (all.length > 20) { setError("一次报销最多 20 份附件，可以将其他费用另建一笔报销。"); return; }
    if (all.some(f => f.size > LIMIT || !f.size) || all.reduce((n, f) => n + f.size, 0) > TOTAL) { setError("每份附件需为 1 字节至 15 MB，合计最多 25 MB。"); return; }
    if (files.some(f => !supportedMaterial(f.name))) { setError(MATERIAL_FORMAT_LABEL); return; }
    if (files.some(f => textMaterial(f.name) && f.size > 1024 * 1024)) { setError("文字格式最多 1 MB。"); return; }
    setEntries(list => [...list, ...files.map((file, i): Entry => ({ id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 10)}`, file, status: "pending" }))]);
    setError(""); setConfirmed(false);
  }
  function correctDocument(id: string, key: RecognitionField, text: string) {
    setEntries(list => list.map(e => {
      if (e.id !== id || !e.result) return e;
      const fields = { ...e.result.fields }; if (text.trim()) fields[key] = text; else delete fields[key];
      return { ...e, edited: true, result: { ...e.result, fields,...(key==="date"?{dateCandidates:text.trim()?[text.trim()]:[],dateBasis:"explicit" as const}:{}) } };
    })); setConfirmed(false);
  }
  function source(key: RecognitionField) {
    const hasManual = manual[key] !== undefined, found = summary.fields[key];
    return <div className={`smart-field-source ${hasManual ? "manual" : found ? "detected" : ""}`}>
      {hasManual ? <><Pencil size={12}/><span>已手动调整</span>{found && <button type="button" disabled={!!draft} onClick={() => restore(key)}>恢复识别</button>}</> : found ? <><Check size={13}/><span title={found.sources.join("、")}>自动填入 · {found.sources.join("、")}</span></> : defaults[key] ? <span>{key === "handler" ? "来自个人设置，仅作为经办人" : key === "date" ? "默认今天，可修改" : "默认人民币，可修改"}</span> : null}
    </div>;
  }
  function field(key: RecognitionField, options: { type?: string; required?: boolean; wide?: boolean; hint?: ReactNode; placeholder?: string } = {}) {
    const conflict = summary.conflicts.find(c => c.field === key);
    return <label className={`field ${options.wide ? "wide" : ""} ${summary.fields[key] && manual[key] === undefined ? "smart-field-detected" : ""}`}>
      <span>{recognitionLabels[key]}{options.required ? " *" : ""}{summary.fields[key] && manual[key] === undefined && <em>已识别</em>}</span>
      {key === "currency" ? <select value={value(key)} disabled={!!draft} onChange={e => change(key, e.target.value)}><option value="">请选择币种</option>{["CNY", "HKD", "MOP", "TWD", "USD"].map(c => <option key={c}>{c}</option>)}</select> : key === "note" ? <textarea value={value(key)} rows={3} disabled={!!draft} maxLength={2000} onChange={e => change(key, e.target.value)}/> : <input value={value(key)} disabled={!!draft} type={options.type || "text"} step={options.type === "number" ? "0.01" : undefined} min={options.type === "number" ? "0.01" : undefined} maxLength={key === "item" ? 160 : key === "invoiceNo" ? 500 : 200} placeholder={options.placeholder || "识别后自动填写，缺失时可补充"} onChange={e => change(key, e.target.value)}/>}
      {source(key)}{options.hint && <small className="field-help">{options.hint}</small>}
      {conflict && <div className="smart-field-conflict"><small>附件中的结果不同，选择本次使用的值：</small>{conflict.options.map(c => <button type="button" key={c.value} disabled={!!draft} title={c.sources.join("、")} onClick={() => change(key, c.value)}>{c.value}</button>)}</div>}
    </label>;
  }

  async function submit() {
    setError("");
    if (reading) { setError("还有附件正在识别，完成后会自动填入。"); return; }
    if (!entries.length) { setError("请先上传本次报销附件。"); return; }
    if (!value("item").trim()) { setError("未能从附件中找到报销事项，请补充事项名称。"); return; }
    const amount = Number(value("amount")), currency = value("currency"), rmb = currency === "CNY" ? amount : Number(value("rmbAmount"));
    if (!Number.isFinite(amount) || amount <= 0 || !currency || !Number.isFinite(rmb) || rmb <= 0) { setError("请补充有效的实付金额和币种；外币报销需有人民币结算金额。"); return; }
    if (!value("date") || Number.isNaN(Date.parse(`${value("date")}T12:00:00`))) { setError("请补充有效的费用日期。"); return; }
    if (invoiceEntries.length && expected.taxId && (!value("taxId") || !taxMatch)) { setError("发票税号未识别或与当前组织不符，请核对识别结果或修正附件中的税号。"); return; }
    if (invoiceEntries.length && expected.invoiceTitle && !value("buyer")) { setError("尚未识别到发票抬头，请核对原件并补充。"); return; }
    const mismatched = invoiceEntries.find(e => { const taxId = invoiceEntries.length === 1 && manual.taxId !== undefined ? value("taxId") : e.result?.fields.taxId; return taxId && expected.taxId && billingKey(taxId) !== billingKey(expected.taxId); });
    if (mismatched) { setError(`「${mismatched.file.name}」的税号与当前组织不同，请在该附件的识别详情中校正，或改选所属组织。`); return; }
    if (!confirmed) { setError("请先确认自动整理的信息。"); return; }
    setSaving(true);
    try {
      let current = draft;
      if (!current) {
        const response = await fetch("/api/activities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: value("item"), itemName: value("item"), submitter: value("name"), handler: value("handler"), contact: value("contact"), department, date: value("date"), reason: value("note") || value("item"), amount: rmb, paidAmount: amount, currency, reviewed: true, ...reimbursementBody(extraValue), category: extraValue.taxiEnabled ? "交通差旅" : summary.category }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        current = { id: data.activity.id, itemId: data.activity.items[0].id }; setDraft(current);
      }
      for (const entry of uniqueEntries) {
        let saved = savedFiles.current.get(entry.id); const doc = entry.result, kind = entry.kind || doc?.kind || "其他";
        if (!saved) {
          const body = new FormData(); body.append("files", entry.file); body.append("itemId", current.itemId); body.append("kind", kind); body.append("skipRecognition", "true");
          const response = await fetch(`/api/activities/${current.id}/files`, { method: "POST", body }); const data = await response.json(); if (!response.ok) throw new Error(data.error);
          saved = { fileId: data.added[0].id, complete: false }; savedFiles.current.set(entry.id, saved);
        }
        if (!saved.complete) {
          const invoice = kind === "发票", one = invoiceEntries.length === 1;
          const prefer = (key: RecognitionField) => invoice && one && manual[key] !== undefined ? value(key) : doc?.fields[key] || (invoice && one ? value(key) : "");
          const meta = { amount: Number(doc?.fields.amount) || null,
            invoiceNo: invoice ? prefer("invoiceNo") : "", buyerName: invoice ? prefer("buyer") : "", buyerTaxId: invoice ? prefer("taxId") : "",
            issuedAt: doc?.meta.issuedAt || "", sellerName: doc?.meta.sellerName || "", sellerTaxId: doc?.meta.sellerTaxId || "", invoiceType: doc?.meta.invoiceType || "", currency: doc?.fields.currency || currency };
          const response = await fetch(`/api/activities/${current.id}/files/${saved.fileId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, meta }) });
          if (!response.ok) throw new Error("附件已保存，识别信息尚未写入。请点击继续保存，无需重新上传。");
          saved.complete = true;
        }
      }
      await onSaved(current.id);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return <div className="intake smart-intake"><button className="text-button back-link" disabled={saving} onClick={onBack}><ChevronLeft size={17}/>返回报销列表</button>
    <div className="intake-heading"><span className="pill blue"><Sparkles size={13}/>智能整理</span><h2>材料放进来，信息自动填好。</h2><p>发票、支付记录、订单和行程单一起上传。核对识别结果，只补充缺失的信息。</p></div>
    <section className="panel smart-upload-panel"><div className="smart-section-heading"><span>01</span><div><h3>上传本次报销材料</h3><p>无需先分类，图片、扫描 PDF 和 TXT 名单都可以识别。</p></div><small>{entries.length} / 20 份</small></div>
      <label className={`smart-upload-drop ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}>
        <span className="smart-upload-icon"><Upload size={27}/></span><strong>{entries.length ? "继续添加附件" : "点击选择，或将文件拖到这里"}</strong><span>PDF / OFD / XML、Word / Excel、文字表格及常見圖片 · 文字 ≤ 1 MB，其他單份 ≤ 15 MB，合計 25 MB</span><input type="file" multiple hidden disabled={saving || !!draft} accept={MATERIAL_ACCEPT} onChange={e => { add(e.target.files); e.target.value = ""; }}/>
      </label>
      <div className="smart-upload-footnote"><ShieldCheck size={15}/><span>文字识别在本机完成，附件不会发送至第三方 AI 或参考网站。</span></div>
      {entries.length > 0 && <><div className="smart-recognition-progress" role="status">{reading ? <LoaderCircle size={17} className="spin"/> : <Check size={17}/>}<span>{reading ? `正在识别 ${entries.find(e => e.status === "reading")?.file.name || "附件"}…` : `已整理 ${done} 份附件`}</span><small>{done} / {entries.length}</small></div>
      <div className="smart-attachment-list">{entries.map(entry => {
        const doc = entry.result, duplicate = summary.duplicates[entry.id], kind = entry.kind || doc?.kind || "其他";
        return <article className={`smart-attachment ${duplicate ? "duplicate" : ""}`} key={entry.id}><div className="smart-attachment-top"><span className="smart-file-icon"><FileText size={21}/></span><div><strong title={entry.file.name}>{entry.file.name}</strong><small>{(entry.file.size / 1048576).toFixed(2)} MB · {duplicate ? "重复附件，已跳过" : entry.status === "pending" ? "等待识别" : entry.status === "reading" ? "正在识别…" : entry.status === "failed" ? "需要补充或重试" : entry.edited ? "已手动校正" : doc?.method === "ocr" ? "图片文字已识别" : doc?.method === "plain-text" ? "TXT 文字已读取" : "PDF 文字已提取"}</small></div>
          {entry.status === "reading" ? <LoaderCircle size={18} className="spin"/> : <select aria-label={`${entry.file.name}的附件类型`} value={kind} disabled={saving || !!draft} onChange={e => { setEntries(list => list.map(v => v.id === entry.id ? { ...v, kind: e.target.value as MatKind } : v)); setConfirmed(false); }}>{MAT_KINDS.map(k => <option key={k}>{k}</option>)}</select>}
          <button className="icon-button" aria-label={`移除${entry.file.name}`} disabled={saving || !!draft || entry.status === "reading"} onClick={() => { setEntries(list => list.filter(v => v.id !== entry.id)); setConfirmed(false); }}><X size={17}/></button></div>
          {entry.error && <div className="smart-file-warning"><AlertCircle size={14}/><span>{entry.error}</span><button className="text-button" disabled={saving || !!draft} onClick={() => setEntries(list => list.map(e => e.id === entry.id ? { ...e, status: "pending", error: undefined } : e))}><RefreshCw size={13}/>重试</button></div>}
          {doc && !duplicate && entry.status === "done" && doc.warnings.map(w => <p className="smart-file-warning" key={w}><AlertCircle size={14}/>{w}</p>)}
          {doc && !duplicate && <details className="smart-document-details"><summary>{Object.keys(doc.fields).length ? `已提取 ${Object.keys(doc.fields).length} 项信息 · 查看或校正` : "查看识别内容"}<ChevronDown size={14}/></summary><div className="smart-document-fields">{(["amount", "invoiceNo", "buyer", "taxId", "name", "handler", "from", "to", "companions"] as RecognitionField[]).filter(k => kind === "发票" || !!doc.fields[k]).map(key => <label className="field" key={key}><span>{key === "amount" && kind === "发票" ? "发票金额" : recognitionLabels[key]}</span><input type={key === "amount" ? "number" : "text"} min={key === "amount" ? "0.01" : undefined} step={key === "amount" ? "0.01" : undefined} value={doc.fields[key] || ""} disabled={saving || !!draft} onChange={e => correctDocument(entry.id, key, e.target.value)}/></label>)}</div>{doc.textPreview && <details className="smart-raw-text"><summary>查看识别文字</summary><pre>{doc.textPreview}</pre></details>}</details>}
        </article>;
      })}</div></>}
    </section>
    <section className="panel smart-results-panel"><div className="smart-section-heading"><span>02</span><div><h3>自动整理的报销信息</h3><p>{Object.keys(summary.fields).length ? `已自动填入 ${Object.keys(summary.fields).length} 项，可直接核对和修改。` : "上传材料后会自动填写；没有出现在附件里的资料才需补充。"}</p></div>{Object.keys(summary.fields).length > 0 && <span className="pill green"><Check size={13}/>已自动填入</span>}</div>
      <div className="form-grid"><label className="field wide"><span>所属组织与部门</span><select value={department} disabled={saving || !!draft} onChange={e => { setDepartment(e.target.value as Department); setExtra(v => ({ ...v, matterId: "" })); setMatterOverride(null); setConfirmed(false); }}>{departments.map(d => <option key={d.id} value={d.id}>{departmentLabel(d.id)}</option>)}</select></label>
        {field("item", { required: true, wide: true })}{field("name", { hint: "费用归属人，可替他人报销；未确定时可稍后补充。" })}{field("handler", { hint: "负责整理、上报材料的人，可以与报销人不同。" })}{field("contact", { placeholder: "选填，附件中出现时会自动填写" })}
        {field("amount", { type: "number", required: true, hint: "优先采用实付记录；发票与支付记录不会重复相加。" })}{field("currency", { required: true })}
        {value("currency") !== "CNY" && field("rmbAmount", { type: "number", required: true, wide: true, hint: "仅采用附件中明确的人民币结算金额，不自行猜测汇率。" })}
        {field("date", { type: "date", required: true, hint: "取自行程／支付日期，未識別時請補充；不使用開票日期。" })}{field("invoiceNo")}
        {field("buyer", { hint: expected.invoiceTitle ? `本组织抬头：${expected.invoiceTitle}` : "识别到发票时自动填入；其他材料可留空。" })}{field("taxId", { hint: expected.taxId ? `本组织税号：${expected.taxId}` : "未设置默认税号时，不强制补填。" })}
        {field("note", { wide: true })}
      </div>
      {summary.warnings.map(w => <p className="smart-notice" key={w}><AlertCircle size={16}/>{w}</p>)}
      {!taxMatch && <p className="smart-notice"><AlertCircle size={16}/>识别到的税号与当前组织不一致，请核对所属部门或附件识别详情。</p>}
      {!titleMatch && <p className="smart-notice"><AlertCircle size={16}/>发票抬头与本组织预设写法不同，请对照附件核对；系统保留原件识别内容。</p>}
      {extraValue.taxiEnabled && <p className="smart-trip-summary"><Check size={16}/>已识别打车资料{value("from") || value("to") ? `：${value("from") || "出发地待补充"} → ${value("to") || "目的地待补充"}` : ""}{value("companions") ? ` · 同行人：${value("companions")}` : ""}</p>}
      <details className="smart-intake-options" open={extraValue.taxiEnabled || undefined}><summary>关联事务、打车资料与报销进度<ChevronDown size={17}/></summary><div className="form-grid"><ReimbursementFields value={extraValue} onChange={next => { for (const key of ["from", "to", "companions"] as const) if (next[key] !== extraValue[key]) change(key, next[key]); if (next.taxiEnabled !== extraValue.taxiEnabled) setTaxiOverride(next.taxiEnabled); if (next.matterId !== extraValue.matterId) setMatterOverride(next.matterId); setExtra(next); setConfirmed(false); }} matters={matters} department={department} disabled={saving || !!draft}/></div></details>
    </section>
    {error && <div className="error-banner smart-intake-error" role="alert"><AlertCircle size={18}/>{error}</div>}
    {draft && error && <p className="smart-notice">基本信息已经保存。点击继续保存即可补齐附件，不会重复建立报销。</p>}
    <section className="smart-intake-submit"><label><input type="checkbox" checked={confirmed} disabled={reading || saving} onChange={e => setConfirmed(e.target.checked)}/><span>我已核对自动填入的信息，确认金额和附件内容一致。</span></label><div><p>先保存为报销草稿，材料不全也可以稍后补充。</p><button className="button primary" disabled={saving || reading || !confirmed} onClick={() => void submit()}>{saving || reading ? <LoaderCircle size={17} className="spin"/> : <Check size={17}/>} {saving ? "正在保存…" : reading ? "正在识别材料…" : draft ? "继续保存附件" : "保存并查看材料"}</button></div></section>
  </div>;
}
