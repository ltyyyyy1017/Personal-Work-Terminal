import type { InvoiceMeta, MatKind } from "./types";
import { parseInvoiceText } from "./invoice";

export type RecognitionField = "item" | "name" | "contact" | "date" | "amount" | "rmbAmount" | "currency" | "buyer" | "taxId" | "invoiceNo" | "from" | "to" | "companions" | "note";
export const recognitionLabels: Record<RecognitionField, string> = { item: "报销事项", name: "报销人", contact: "联系方式", date: "费用日期", amount: "实付金额", rmbAmount: "人民币报销金额", currency: "币种", buyer: "发票抬头", taxId: "购买方税号", invoiceNo: "发票号码", from: "出发地", to: "目的地", companions: "同行人", note: "用途 / 备注" };
export interface RecognizedDocument {
  id: string; name: string; fingerprint: string; kind: MatKind; method: "pdf-text" | "ocr" | "unreadable";
  fields: Partial<Record<RecognitionField, string>>; meta: InvoiceMeta; reference?: string;
  taxi: boolean; category?: string; confidence: number; pages?: number; textPreview: string; warnings: string[];
  refund?: boolean;
}
export interface Suggestion { value: string; sources: string[] }
export interface RecognitionSummary {
  fields: Partial<Record<RecognitionField, Suggestion>>;
  conflicts: { field: RecognitionField; options: Suggestion[] }[];
  duplicates: Record<string, string>; warnings: string[]; taxi: boolean; category: string;
}
export function readableText(raw: string) {
  return raw.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ")
    .replace(/發票/g, "发票").replace(/購買方/g, "购买方").replace(/銷售方/g, "销售方")
    .replace(/名稱/g, "名称").replace(/納稅人識別號/g, "纳税人识别号").replace(/統一社會信用代碼/g, "统一社会信用代码")
    .replace(/開票日期/g, "开票日期").replace(/價稅合計/g, "价税合计").replace(/號碼/g, "号码");
}
function dateValue(text: string) {
  const m = text.match(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  if (!m) return undefined;
  const value = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
function labeled(text: string, labels: string, max = 100) {
  const m = text.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*([^\\n]{1,${max}})`));
  return m?.[1]?.trim().replace(/\s+(?:数量|金额|规格型号|订单号|订单编号|交易单号|支付方式|付款方式|付款时间|交易时间|税率).*$/, "").trim();
}
function money(text: string, pattern: RegExp) {
  const m = text.match(pattern), n = m && Number(m[1].replace(/[,\s]/g, ""));
  return n && Number.isFinite(n) && n > 0 && n < 100_000_000 ? n.toFixed(2) : undefined;
}
function currencyValue(text: string) {
  if (/HK\$|HKD|港币|港幣|港元/i.test(text)) return "HKD";
  if (/MOP|澳门元|澳門元|澳门币|澳門幣/i.test(text)) return "MOP";
  if (/TWD|NT\$|新台币|新臺幣/i.test(text)) return "TWD";
  if (/USD|美元|美金|US\$/i.test(text)) return "USD";
  if (/CNY|RMB|人民币|人民幣|[¥￥]|增值税|价税合计/i.test(text)) return "CNY";
  return undefined;
}
export function parseMaterialText(raw: string, file: { id: string; name: string; fingerprint: string; method: RecognizedDocument["method"]; confidence?: number; pages?: number }): RecognizedDocument {
  const text = readableText(raw), compact = text.replace(/\s/g, "");
  const invoice = /(?:发票号码|发票代码|增值税.*发票|电子发票)/.test(compact);
  const itinerary = !invoice && /行程单|行程明细|出行记录|行程信息|起点.*终点/.test(compact + file.name);
  const payment = !invoice && !itinerary && /支付成功|付款成功|交易成功|交易单号|付款金额|微信支付|支付宝账单|實付|实付/.test(compact);
  const kind: MatKind = invoice ? "发票" : itinerary ? "行程单" : payment ? "支付截图" : /收据|收據/.test(compact + file.name) ? "收据" : /订单|商品|交易信息|订单详情|清单/.test(compact + file.name) ? "清单" : /发票/i.test(file.name) ? "发票" : /行程/i.test(file.name) ? "行程单" : /支付|付款/i.test(file.name) ? "支付截图" : "其他";
  const meta = parseInvoiceText(text), fields: RecognizedDocument["fields"] = {};
  if (kind === "发票") {
    if (meta.buyerName) fields.buyer = meta.buyerName;
    if (meta.buyerTaxId) fields.taxId = meta.buyerTaxId;
    if (meta.invoiceNo) fields.invoiceNo = meta.invoiceNo;
    if (meta.amount) fields.amount = meta.amount.toFixed(2);
  }
  const paid = money(compact, /(?:实付(?:金额|款)?|实际支付|实际付款|支付金额|付款金额|已支付|實付(?:金額)?)[^\d]{0,10}([\d,]+(?:\.\d{1,2})?)/)
    || (kind === "支付截图" ? money(compact, /(?:支付成功|付款成功|交易成功)[^\d]{0,20}(?:[¥￥]|HK\$|MOP|USD|CNY|RMB)?([\d,]+\.\d{2})/i) || money(text, /(?:^|\n)\s*[-−]?[¥￥]\s*([\d,]+\.\d{2})/) : undefined);
  if (kind !== "发票") fields.amount = paid || money(compact, /(?:合计(?:金额)?|总计|总金额|费用合计|车费|票价|金額)[^\d]{0,10}([\d,]+\.\d{2})/);
  const dateText = labeled(text, "支付时间|付款时间|交易时间|出行日期|行程日期|乘车日期|用车日期|日期", 40);
  fields.date = (dateText && dateValue(dateText)) || meta.issuedAt || dateValue(text);
  fields.currency = currencyValue(text);
  fields.rmbAmount = money(compact, /(?:折合人民币(?:金额)?|人民币结算金额|实际人民币支出|人民币实付金额)[^\d]{0,10}([\d,]+(?:\.\d{1,2})?)/);
  fields.name = labeled(text, "报销人(?:姓名)?|申请人(?:姓名)?|付款人姓名|支付人姓名|乘车人姓名|乘车人|乘客姓名", 30);
  if (fields.name) fields.name = fields.name.split(/[\s,，;；:：]/)[0];
  fields.contact = labeled(text, "申请人手机(?:号)?|报销人联系方式|付款人手机(?:号)?", 50);
  const taxi = /打车|出租车|网约车|滴滴|的士|客运服务|客運服務/.test(compact + file.name);
  let subject = labeled(text, "商品说明|商品名称|项目名称|费用名称|交易说明|服务名称|報銷事項|报销事项", 100);
  if (subject && /^(?:规格|单位|数量|单价|金额|税率|税额|货物或)/.test(subject)) subject = undefined;
  const starItem = text.match(/[*＊][^*＊\n]{1,25}[*＊]\s*([^\n*＊]{2,65})/);
  if (starItem) subject = starItem[1].split(/\s+\d|规格型号|税率|数量/)[0].trim();
  if (!subject && taxi) subject = "打车费用";
  fields.item = subject?.replace(/^[*＊\s]+/, "").slice(0, 120);
  fields.from = labeled(text, "出发地|上车地点|起点|出發地|上車地點", 100);
  fields.to = labeled(text, "目的地|下车地点|终点|終點|下車地點", 100);
  fields.companions = labeled(text, "同行人(?:员)?|同行人員", 150);
  fields.note = labeled(text, "报销用途|用途|备注|備註", 160);
  const category = taxi ? "交通差旅" : /打印|印刷|复印|影印/.test(compact) ? "打印制作" : /餐饮|餐費|餐费|餐厅|餐廳/.test(compact) ? "餐饮接待" : /文具|办公用品|配件|物资/.test(compact) ? "物资采购" : "其他";
  for (const k of Object.keys(fields) as RecognitionField[]) if (!fields[k]) delete fields[k];
  const refund = /退款成功|退款完成|全额退款|红字发票|负数发票|已冲红|小写[^\d\n]{0,5}[-−]/.test(compact);
  if (refund) delete fields.amount;
  return { ...file, kind, fields, meta, reference: labeled(text, "交易单号|订单编号|订单号|商户单号|支付单号", 80)?.replace(/\s/g, ""), taxi, category,
    confidence: file.confidence ?? 1, textPreview: text.slice(0, 3000), refund, warnings: refund ? ["检测到退款或红字票据，未将票面金额当作报销支出，请核对实际净支出。"] : [] };
}

export function summarizeRecognition(input: RecognizedDocument[]): RecognitionSummary {
  const fields: RecognitionSummary["fields"] = {}, conflicts: RecognitionSummary["conflicts"] = [], duplicates: Record<string, string> = {}, warnings: string[] = [];
  const seen = new Map<string, RecognizedDocument>(), seenInvoices = new Map<string, RecognizedDocument>();
  let overlappingInvoices = false;
  const docs = input.filter(doc => {
    const previous = seen.get(doc.fingerprint); if (previous) { duplicates[doc.id] = previous.id; return false; }
    seen.set(doc.fingerprint, doc);
    if (doc.kind === "发票" && doc.fields.invoiceNo) {
      const prev = seenInvoices.get(doc.fields.invoiceNo);
      if (prev && prev.fields.amount === doc.fields.amount && prev.fields.taxId === doc.fields.taxId) { duplicates[doc.id] = prev.id; return false; }
      if (prev) warnings.push(`同一发票号码的识别信息不一致：${prev.name}、${doc.name}，请核对或移除重复附件。`);
      seenInvoices.set(doc.fields.invoiceNo, doc);
    }
    return true;
  });
  const invoiceOwners = new Map<string,string>();
  for (const doc of docs.filter(d => d.kind === "发票")) for (const no of doc.fields.invoiceNo?.split(/[、,，;；\s]+/).filter(Boolean) || []) {
    if (invoiceOwners.has(no)) overlappingInvoices = true;
    invoiceOwners.set(no,doc.name);
  }
  const groups = (key: RecognitionField, list = docs) => {
    const values = new Map<string, Suggestion>();
    for (const doc of list) { const value = doc.fields[key]?.trim(); if (!value) continue; const existing = values.get(value); if (existing) existing.sources.push(doc.name); else values.set(value, { value, sources: [doc.name] }); }
    return [...values.values()];
  };
  function single(key: RecognitionField, list = docs) {
    const values = groups(key, list);
    if (values.length === 1) fields[key] = values[0];
    else if (values.length > 1) conflicts.push({ field: key, options: values });
  }
  const invoices = docs.filter(d => d.kind === "发票"), payments = docs.filter(d => d.kind === "支付截图"), others = docs.filter(d => d.kind !== "发票" && d.kind !== "支付截图");
  for (const k of ["buyer", "taxId", "name", "contact", "from", "to", "companions", "rmbAmount"] as RecognitionField[]) single(k, k === "buyer" || k === "taxId" ? invoices : docs);
  const notes = groups("note"); if (notes.length) fields.note = { value: notes.map(n => n.value).join("\n"), sources: notes.flatMap(n => n.sources) };
  const numbers = groups("invoiceNo", invoices); if (numbers.length) fields.invoiceNo = { value: numbers.map(n => n.value).join("、"), sources: numbers.flatMap(n => n.sources) };
  const subjects = groups("item", invoices).length ? groups("item", invoices) : groups("item", others).length ? groups("item", others) : groups("item", payments);
  if (subjects.length) fields.item = { value: subjects.map(s => s.value).join("、").slice(0, 160), sources: [...new Set(subjects.flatMap(s => s.sources))] };
  // Dates are expense dates: payment first, then travel, then invoice issue date. Never choose silently between multiple dates.
  const dated = payments.some(d => d.fields.date) ? payments : others.some(d => d.fields.date) ? others : invoices;
  single("date", dated);
  single("currency", docs);
  const validMoney = (list: RecognizedDocument[]) => list.length > 0 && list.every(d => Number(d.fields.amount) > 0) && groups("currency", list).length <= 1;
  const total = (list: RecognizedDocument[]) => list.reduce((sum, d) => sum + Math.round(Number(d.fields.amount) * 100), 0) / 100;
  const invoiceDistinct = invoices.length === 1 || invoices.every(d => d.fields.invoiceNo) && new Set(invoices.map(d => d.fields.invoiceNo)).size === invoices.length;
  const invoiceSum = validMoney(invoices) && invoiceDistinct ? total(invoices) : undefined;
  const paidDistinct = payments.length === 1 || payments.length > 1 && payments.every(d => d.reference) && new Set(payments.map(d => d.reference)).size === payments.length;
  const paymentSum = validMoney(payments) && paidDistinct ? total(payments) : undefined;
  const paymentCurrencies = groups("currency", payments);
  if (paymentSum !== undefined && paymentCurrencies.length === 1) {
    const crossCurrency = conflicts.find(c => c.field === "currency");
    if (crossCurrency) { conflicts.splice(conflicts.indexOf(crossCurrency), 1); warnings.push(`附件原币与支付币种不同，已按支付记录的 ${paymentCurrencies[0].value} 实付金额填写；原发票金额和币种分别保留。`); }
    fields.currency = paymentCurrencies[0];
  }
  if (payments.length && paidDistinct && payments.every(d => Number(d.fields.rmbAmount) > 0)) fields.rmbAmount = { value: (payments.reduce((s,d) => s + Math.round(Number(d.fields.rmbAmount)*100),0)/100).toFixed(2), sources: payments.map(d => d.name) };
  if (!conflicts.some(c => c.field === "currency")) {
    const chosen = paymentSum ?? invoiceSum;
    if (chosen !== undefined) fields.amount = { value: chosen.toFixed(2), sources: (paymentSum !== undefined ? payments : invoices).map(d => d.name) };
    else single("amount", docs.length === 1 ? docs : others.length === 1 ? others : payments);
  }
  if (paymentSum !== undefined && invoiceSum !== undefined && groups("currency", [...invoices, ...payments]).length <= 1 && Math.abs(paymentSum - invoiceSum) > .01) warnings.push(`支付记录合计 ${paymentSum.toFixed(2)}，发票合计 ${invoiceSum.toFixed(2)}；已填实付金额，请确认两者差额。`);
  if (payments.length > 1 && !paidDistinct) warnings.push("多份支付记录缺少可区分的单号，没有直接相加；请核对实付金额，避免同一笔支付重复计入。");
  if (invoices.length > 1 && !invoiceDistinct) warnings.push("部分发票缺少可区分的票号，或同号信息存在差异，未直接合计；请核对附件识别详情。");
  if (Object.keys(duplicates).length) warnings.push(`检测到 ${Object.keys(duplicates).length} 份重复附件，保存和金额汇总时会自动跳过。`);
  if (docs.some(d => d.refund)) { delete fields.amount; warnings.push("附件包含退款或红字票据，实付金额需要按实际净支出确认，未自动采用原支付或票面金额。"); }
  if (overlappingInvoices) { delete fields.amount; warnings.push("合并 PDF 与其他附件含有重叠票号，未自动合计金额；移除重复票据后可重新自动整理。"); }
  return { fields, conflicts, duplicates, warnings, taxi: docs.some(d => d.taxi), category: docs.find(d => d.category && d.category !== "其他")?.category || "其他" };
}
