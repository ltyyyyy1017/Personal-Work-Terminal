import { DEFAULT_NAMING, KIND_ORDER } from "./constants";
import type { ReimbActivity, ReimbFile, ReimbItem } from "./types";

/** 128 / 128.5 / 1280.05，去掉多余小数位 */
export function formatAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "0";
  const rounded = Math.round(Number(n) * 100) / 100;
  return String(rounded);
}

export function fmtMoney(n: number | null | undefined, withSymbol = false): string {
  const v = Number(n ?? 0);
  const body = v.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `¥${body}` : body;
}

export function sanitizeFileBase(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120);
}

export function materialFileName(opts: {
  seq: string;
  item: string;
  amount: number | null;
  kind: string;
  template?: string;
  extension?: ".pdf" | ".txt";
}): string {
  const template = opts.template || DEFAULT_NAMING;
  const base = template
    .replace(/\{seq\}/g, opts.seq)
    .replace(/\{item\}/g, sanitizeFileBase(opts.item || "未命名事项"))
    .replace(/\{amount\}/g, formatAmount(opts.amount))
    .replace(/\{kind\}/g, opts.kind)
    .replace(/\{date\}/g, "");
  return `${sanitizeFileBase(base)}${opts.extension || ".pdf"}`;
}

export function kindRank(kind: string): number {
  return KIND_ORDER[kind] ?? 99;
}

export function sortFiles<T extends { kind: string; order: number; addedAt?: string }>(
  files: T[],
): T[] {
  return [...files].sort((a, b) => {
    const r = kindRank(a.kind) - kindRank(b.kind);
    if (r !== 0) return r;
    const o = (a.order ?? 0) - (b.order ?? 0);
    if (o !== 0) return o;
    return String(a.addedAt ?? "").localeCompare(String(b.addedAt ?? ""));
  });
}

export interface NamingPlanRow {
  fileId: string;
  itemId: string;
  seq: string;
  name: string;
  kind: string;
  amount: number | null;
}

/** 依据事项顺序与材料类型顺序，生成 1-1 / 1-2 / 2-1 这样的编号与最终文件名 */
export function namingPlan(
  activity: Pick<ReimbActivity, "items" | "files">,
  template?: string,
): NamingPlanRow[] {
  const rows: NamingPlanRow[] = [];
  const items = activity.items ?? [];
  items.forEach((item, itemIdx) => {
    const files = sortFiles(
      (activity.files ?? []).filter((f) => f.itemId === item.id),
    );
    files.forEach((file, fileIdx) => {
      const seq = `${itemIdx + 1}-${fileIdx + 1}`;
      rows.push({
        fileId: file.id,
        itemId: item.id,
        seq,
        kind: file.kind,
        amount: item.amount,
        name: materialFileName({
          seq,
          item: item.name,
          amount: item.amount,
          kind: file.kind,
          template,
          extension: /\.txt$/i.test(file.originalName) ? ".txt" : ".pdf",
        }),
      });
    });
  });
  // 未归入事项的材料
  const loose = sortFiles((activity.files ?? []).filter((f) => !f.itemId));
  loose.forEach((file, i) => {
    const seq = `0-${i + 1}`;
    rows.push({
      fileId: file.id,
      itemId: "",
      seq,
      kind: file.kind,
      amount: null,
      name: materialFileName({
        seq,
        item: "未归类",
        amount: null,
        kind: file.kind,
        template,
        extension: /\.txt$/i.test(file.originalName) ? ".txt" : ".pdf",
      }),
    });
  });
  return rows;
}

/** 识别材料类型：优先看文件名，其次看 PDF 文本 */
export function suggestKind(fileName: string, text?: string): ReimbFile["kind"] {
  const n = fileName.toLowerCase();
  if (/行程单|行程|itinerary|e-ticket/.test(n)) return "行程单";
  if (/发票|invoice|fapiao|数电票/.test(n)) return "发票";
  if (/销售单|销售|sales/.test(n)) return "销售单";
  if (/送货单|送货|配送/.test(n)) return "送货单";
  if (/清单|明细|报价|采购单|订单/.test(n)) return "清单";
  if (/支付|付款|转账|收款|截图|screenshot|支付成功/.test(n)) return "支付截图";
  if (/收据|小票|receipt/.test(n)) return "收据";
  if (/合同|协议|contract/.test(n)) return "合同";

  const t = (text ?? "").replace(/\s+/g, "");
  if (/行程单|航班|车次|电子客票/.test(t)) return "行程单";
  if (/发票号码|价税合计|购买方|销售方|开票日期/.test(t)) return "发票";
  if (/送货单/.test(t)) return "送货单";
  if (/销售单/.test(t)) return "销售单";
  if (/收据|收款收据/.test(t)) return "收据";
  return "其他";
}

export function itemTotals(items: ReimbItem[], files: ReimbFile[]) {
  const known = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const invoiced = files
    .filter((f) => f.kind === "发票" && typeof f.meta?.amount === "number")
    .reduce((s, f) => s + Number(f.meta?.amount || 0), 0);
  return { declared: Math.round(known * 100) / 100, invoiced: Math.round(invoiced * 100) / 100 };
}

export function countByKind(files: ReimbFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

/** 人民币大写 */
const CN_DIGITS = "零壹贰叁肆伍陆柒捌玖";
const CN_UNITS = ["", "拾", "佰", "仟"];

function sectionToCN(sec: number): string {
  let s = "";
  let zero = false;
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(sec / 10 ** i) % 10;
    if (d === 0) {
      if (s) zero = true;
    } else {
      if (zero) {
        s += "零";
        zero = false;
      }
      s += CN_DIGITS[d] + CN_UNITS[i];
    }
  }
  return s;
}

export function intToCN(n: number): string {
  if (n === 0) return "零";
  const SEC = ["", "万", "亿", "兆"];
  const secs: number[] = [];
  let x = n;
  while (x > 0) {
    secs.push(x % 10000);
    x = Math.floor(x / 10000);
  }
  let out = "";
  for (let i = secs.length - 1; i >= 0; i--) {
    const v = secs[i];
    if (v === 0) {
      if (out && !out.endsWith("零")) out += "零";
      continue;
    }
    if (out && v < 1000 && !out.endsWith("零")) out += "零";
    out += sectionToCN(v) + SEC[i];
  }
  return out.replace(/零+$/, "");
}

export function rmbUpper(input: number | string | null | undefined): string {
  const value = Number(input ?? 0);
  if (!Number.isFinite(value)) return "零元整";
  const neg = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  if (cents === 0) return "零元整";
  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor(cents / 10) % 10;
  const fen = cents % 10;
  let s = "";
  if (yuan > 0) s += intToCN(yuan) + "元";
  if (jiao > 0) s += CN_DIGITS[jiao] + "角";
  else if (yuan > 0 && fen > 0) s += "零";
  if (fen > 0) s += CN_DIGITS[fen] + "分";
  if (yuan > 0 && jiao === 0 && fen === 0) s += "整";
  if (yuan === 0 && jiao > 0 && fen === 0) s += "整";
  return (neg ? "负" : "") + s;
}
