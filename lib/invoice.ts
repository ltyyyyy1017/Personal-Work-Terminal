import type { InvoiceMeta } from "./types";

function normalizeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/發票/g, "发票").replace(/購買方/g, "购买方").replace(/銷售方/g, "销售方")
    .replace(/名稱/g, "名称").replace(/納稅人識別號/g, "纳税人识别号").replace(/統一社會信用代碼/g, "统一社会信用代码")
    .replace(/開票日期/g, "开票日期").replace(/價稅合計/g, "价税合计").replace(/號碼/g, "号码")
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

/** Extract only within a named party's section; an unscoped merchant is never a buyer. */
function invoiceParties(text: string) {
  const compact = text.replace(/\s+/g, "").replace(/购方/g, "购买方").replace(/销方/g, "销售方");
  const headings = [...compact.matchAll(/购买方(?:信息)?|销售方(?:信息)?/g)].filter(m => m[0].endsWith("信息") || !/税号|名称/.test(compact.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2)));
  const namePattern = /名称[:：]?([^:：]{2,150}?)(?=名称[:：]|统一社会信用代码|纳税人识别号|税号|地址|开户|电话|销售方|购买方|项目名称|货物或|金额|规格型号|备注|$)/g;
  const taxPattern = /(?:统一社会信用代码|纳税人识别号|税号)(?:[/／](?:纳税人识别号|统一社会信用代码))?[:：]?([0-9A-Z]{15,20})(?![0-9A-Z])/g;
  const nameIn = (block: string) => [...block.matchAll(new RegExp(namePattern))].map(m => m[1].replace(/[|｜]+$/, "").trim()).filter(n => n && !/[:：]|名称|识别号/.test(n));
  const taxIn = (block: string) => [...block.matchAll(new RegExp(taxPattern))].map(m => m[1]);
  const result: { buyerName?: string; sellerName?: string; buyerTaxId?: string; sellerTaxId?: string } = {};
  const buyer = headings.find(m => m[0].startsWith("购买")), seller = headings.find(m => m[0].startsWith("销售"));
  // Adjacent headings above two columns: use the observed heading order, including reversed columns.
  if (buyer && seller) {
    const first = buyer.index! < seller.index! ? buyer : seller, second = first === buyer ? seller : buyer;
    const between = compact.slice(first.index! + first[0].length, second.index!);
    if (!/名称|识别号|信用代码/.test(between) && between.length < 16) {
      const block = compact.slice(second.index! + second[0].length).split(/项目名称|货物或|规格型号|价税合计|合计金额|备注/)[0];
      const names = nameIn(block), taxes = taxIn(block), buyerIndex = first === buyer ? 0 : 1;
      if (names.length === 2) { result.buyerName = names[buyerIndex]; result.sellerName = names[1 - buyerIndex]; }
      if (taxes.length === 2) { result.buyerTaxId = taxes[buyerIndex]; result.sellerTaxId = taxes[1 - buyerIndex]; }
      return result;
    }
  }
  for (const [prefix, heading] of [["buyer", buyer], ["seller", seller]] as const) {
    if (!heading) continue;
    const rest = compact.slice(heading.index! + heading[0].length).split(/购买方|销售方|项目名称|货物或|规格型号|价税合计|备注/)[0];
    const names = nameIn(rest), taxes = taxIn(rest);
    if (names.length === 1) result[`${prefix}Name`] = names[0];
    if (taxes.length === 1) result[`${prefix}TaxId`] = taxes[0];
  }
  // Explicit scoped labels also appear on receipts, without section headings.
  for (const [prefix, label] of [["buyer", "购买方"], ["seller", "销售方"]] as const) {
    const explicit = compact.match(new RegExp(`${label}名称[:：]([^:：]{2,150}?)(?=${label}税号|购买方|销售方|统一社会信用代码|纳税人识别号|地址|电话|项目名称|备注|$)`));
    if (explicit) result[`${prefix}Name`] = explicit[1];
    const tax = compact.match(new RegExp(`${label}(?:税号|纳税人识别号)[:：]?([0-9A-Z]{15,20})(?![0-9A-Z])`));
    if (tax) result[`${prefix}TaxId`] = tax[1];
  }
  return result;
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

  const parties = invoiceParties(text);
  const { buyerName, sellerName, buyerTaxId, sellerTaxId } = parties;

  if (buyerName) {
    hints.push("购买方");
    score += 1;
  }
  if (sellerName) hints.push("销售方");

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
