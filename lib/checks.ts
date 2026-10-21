import type { ReimbActivity, Settings } from "./types";
import {organizationSettings} from "./organizations";

export type CheckLevel = "error" | "warn" | "info" | "ok";

export interface CheckItem {
  id: string;
  level: CheckLevel;
  title: string;
  detail?: string;
}

const money = (n: number) => n.toFixed(2);

/** 打包前的体检：缺件、金额对不上、抬头税号不一致、重复票号等 */
export function analyzeActivity(activity: ReimbActivity, settings: Settings): CheckItem[] {
  settings=organizationSettings(settings,activity.department);
  const checks: CheckItem[] = [];
  const items = activity.items ?? [];
  const files = activity.files ?? [];

  if (!items.length) {
    checks.push({ id: "no-item", level: "error", title: "还没有事项", detail: "先添加一个报销事项，并填写名称与金额。" });
  }
  if (!files.length) {
    checks.push({ id: "no-file", level: "error", title: "还没有材料", detail: "上传发票、销售单、行程单等材料后才能打包。" });
  }

  const loose = files.filter((f) => !f.itemId);
  if (loose.length) {
    checks.push({
      id: "loose",
      level: "warn",
      title: `${loose.length} 份材料未归入事项`,
      detail: "打包时会被放进 0-1 这样的编号，建议先归到对应事项。",
    });
  }

  items.forEach((item, idx) => {
    const itemFiles = files.filter((f) => f.itemId === item.id);
    const label = `事项 ${idx + 1}「${item.name || "未命名"}」`;
    if (!item.name.trim()) {
      checks.push({ id: `name-${item.id}`, level: "warn", title: `${label}缺少名称` });
    }
    if (item.amount === null || item.amount === undefined) {
      checks.push({
        id: `amount-${item.id}`,
        level: "warn",
        title: `${label}未填写金额`,
        detail: "文件名里的金额会显示为 0 元。",
      });
    }
    if (!itemFiles.length) {
      checks.push({ id: `files-${item.id}`, level: "warn", title: `${label}还没有材料` });
      return;
    }
    const invoices = itemFiles.filter((f) => f.kind === "发票");
    if (!invoices.length) {
      checks.push({
        id: `inv-${item.id}`,
        level: "warn",
        title: `${label}没有发票`,
        detail: "只有销售单/截图，财务通常不认；请补一张发票。",
      });
    }
    const invoiceSum = invoices.reduce(
      (s, f) => s + (typeof f.meta?.amount === "number" ? Number(f.meta.amount) : 0),
      0,
    );
    if (invoices.length && typeof item.amount === "number" && invoiceSum > 0 && (!activity.currency || activity.currency==="CNY") && invoices.every(f => !f.meta?.currency || f.meta.currency === (activity.currency || "CNY"))) {
      if (Math.abs(invoiceSum - item.amount) > 0.01) {
        checks.push({
          id: `sum-${item.id}`,
          level: "warn",
          title: `${label}金额不一致`,
          detail: `事项填写 ¥${money(item.amount)}，发票识别合计 ¥${money(invoiceSum)}，请核对。`,
        });
      }
    }
    if (activity.category === "交通差旅" && !itemFiles.some((f) => f.kind === "行程单")) {
      checks.push({
        id: `trip-${item.id}`,
        level: "info",
        title: `${label}还没有行程单`,
        detail: "交通报销建议附上行程单，可在事项里补充行程后一并导出。",
      });
    }
  });

  const title = settings.reimbursement.invoiceTitle.trim();
  const taxId = settings.reimbursement.taxId.trim().toUpperCase();
  if (title || taxId) {
    const bad = files.filter((f) => {
      if (f.kind !== "发票" || !f.meta) return false;
      const buyerOk = !title || !f.meta.buyerName || f.meta.buyerName.includes(title);
      const taxOk =
        !taxId || !f.meta.buyerTaxId || f.meta.buyerTaxId.toUpperCase() === taxId;
      return !buyerOk || !taxOk;
    });
    if (bad.length) {
      checks.push({
        id: "title",
        level: "warn",
        title: `${bad.length} 张发票抬头/税号与默认不符`,
        detail: bad.map((f) => f.originalName).join("、").slice(0, 200),
      });
    } else if (files.some((f) => f.kind === "发票" && f.meta?.buyerName)) {
      checks.push({ id: "title-ok", level: "ok", title: "发票抬头与税号核对通过" });
    }
  } else {
    checks.push({
      id: "title-empty",
      level: "info",
      title: "尚未设置默认抬头 / 税号",
      detail: "在「设置 · 报销默认」里填好后，可以自动核对每张发票。",
    });
  }

  const seen = new Map<string, string>();
  files.forEach((f) => {
    const numbers = f.meta?.invoiceNo?.split(/[、,，;；\s]+/).filter(Boolean) || [];
    for (const no of numbers) {
    if (seen.has(no)) {
      checks.push({
        id: `dup-${no}`,
        level: "warn",
        title: `发票号码重复：${no}`,
        detail: "同一张发票被上传了两次，打包前建议删掉一份。",
      });
    } else {
      seen.set(no, f.id);
    }
    }
  });

  if (!checks.some((c) => c.level === "error" || c.level === "warn")) {
    checks.push({ id: "all-ok", level: "ok", title: "材料齐备，可以打包" });
  }
  return checks;
}

export function summarizeChecks(checks: CheckItem[]) {
  return {
    errors: checks.filter((c) => c.level === "error").length,
    warnings: checks.filter((c) => c.level === "warn").length,
    oks: checks.filter((c) => c.level === "ok").length,
  };
}
