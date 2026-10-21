import type { InvoiceMeta } from "./types";

function normalizeText(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[／]/g, "/")
    .replace(/[ \t]+/g, " ");
}

function toNumber(v?: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[,¥￥\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * 从电子发票 / 行程单的文本层里尽量抽取字段。
 * 全电发票、增值税电子发票、火车票、航空行程单都做了兼容，识别不到就返回空字段。
 */
export function parseInvoiceText(raw: string): InvoiceMeta {
  const text = normalizeText(raw || "");
  const compact = text.replace(/\s+/g, "");
  const hints: string[] = [];
  let score = 0;

  let invoiceNo: string | undefined;
  const noMatch =
    compact.match(/发票号码:?(\d{8,20})/) ??
    compact.match(/票据号码:?(\d{8,20})/) ??
    compact.match(/发票代码:?\d{10,12}发票号码:?(\d{8})/);
  if (noMatch?.[1]) {
    invoiceNo = noMatch[1];
    hints.push("发票号码");
    score += 1;
  }

  let issuedAt: string | undefined;
  const dateMatch =
    text.match(/开票日期[:：]?\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/) ??
    text.match(/开票日期[:：]?\s*(\d{4})-(\d{1,2})-(\d{1,2})/) ??
    text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dateMatch) {
    issuedAt = `${dateMatch[1]}-${String(Number(dateMatch[2])).padStart(2, "0")}-${String(
      Number(dateMatch[3]),
    ).padStart(2, "0")}`;
    const parsed = new Date(`${issuedAt}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== issuedAt) issuedAt = undefined;
    else { hints.push("开票日期"); score += 1; }
  }

  let amount: number | null = null;
  const amountPatterns = [
    /\(小写\)[:：]?[¥￥]?([\d,]+(?:\.\d{1,2})?)/,
    /小写[:：]?[¥￥]?([\d,]+(?:\.\d{1,2})?)/,
    /价税合计[^0-9]{0,14}[¥￥]?([\d,]+\.\d{2})/,
    /(?:票价|合计金额|金额合计|总计)[:：]?[¥￥]?([\d,]+\.\d{2})/,
  ];
  for (const pattern of amountPatterns) {
    const m = compact.match(pattern) ?? text.match(pattern);
    const n = toNumber(m?.[1]);
    if (n && n > 0) {
      amount = n;
      hints.push("金额");
      score += 1;
      break;
    }
  }
  if (amount === null) {
    const values = [...new Set([...compact.matchAll(/[¥￥]([\d,]+\.\d{2})/g)].map(m => toNumber(m[1])).filter((n): n is number => n !== null && n > 0))];
    if (values.length === 1) { amount = values[0]; hints.push("唯一明确金额"); score += 1; }
  }

  // 购买方 / 销售方：全电发票通常是「购买方信息 名称:XXX 统一社会信用代码:...」
  const sellerIdx = compact.search(/销售方(?:信息)?/);
  const buyerPart = sellerIdx > 0 ? compact.slice(0, sellerIdx) : compact;
  const sellerPart = sellerIdx > 0 ? compact.slice(sellerIdx) : "";

  const nameIn = (block: string): string | undefined => {
    if (!block) return undefined;
    const m =
      block.match(/名称:?([\u4e00-\u9fa5A-Za-z0-9()·&\-]{2,50}?)(?=统一社会信用代码|纳税人识别号|地址|开户行|电话|销售方|项目名称|备注|$)/) ??
      block.match(/名称:?([\u4e00-\u9fa5A-Za-z0-9()·&\-]{2,50})/);
    return m?.[1];
  };

  let buyerName = nameIn(buyerPart.match(/购买方(?:信息)?(.*)/)?.[1] ?? buyerPart);
  let sellerName = nameIn(sellerPart);
  // Full electronic invoices often put both column headings before either name.
  const columnNames = [...compact.matchAll(/名称:([\u4e00-\u9fffA-Za-z0-9()·&\-]{2,100}?)(?=名称:|统一社会信用代码|纳税人识别号|地址|开户行|电话|项目名称|备注|销售方|购买方|$)/g)].map(m => m[1]);
  if (sellerIdx > 0 && /购买方/.test(buyerPart) && columnNames.length >= 2 && !buyerName) {
    buyerName = columnNames[0]; sellerName = columnNames[1];
  }

  if (buyerName) {
    hints.push("购买方");
    score += 1;
  }
  if (sellerName) hints.push("销售方");

  const taxIds = [
    ...compact.matchAll(
      /(?:统一社会信用代码|纳税人识别号|税号)[/／]?(?:纳税人识别号)?[:：]?([0-9A-Z]{15,20})/g,
    ),
  ].map((m) => m[1]);
  const buyerTaxId = taxIds[0];
  const sellerTaxId = taxIds[1];

  const typeMatch =
    compact.match(/电子发票\(([^)]{1,20})\)/) ??
    compact.match(/(增值税(?:专用|普通)发票)/) ??
    (compact.includes("行程单") ? ["", "航空运输电子客票行程单"] : null) ??
    (compact.match(/铁路电子客票|火车票/) ? ["", "铁路电子客票"] : null);
  const invoiceType = typeMatch?.[1];

  return {
    invoiceNo,
    issuedAt,
    amount,
    buyerName,
    buyerTaxId,
    sellerName,
    sellerTaxId,
    invoiceType,
    confidence: Math.min(1, score / 4),
    rawHints: hints,
  };
}

export function emptyMeta(): InvoiceMeta {
  return { confidence: 0 };
}
