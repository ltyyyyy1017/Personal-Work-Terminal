import type { MatKind } from "./types";

export const MAT_KINDS: MatKind[] = [
  "发票",
  "销售单",
  "送货单",
  "清单",
  "行程单",
  "同行人",
  "支付截图",
  "收据",
  "合同",
  "其他",
];

/** 打包时的材料排序：票据在前，佐证在后 */
export const KIND_ORDER: Record<string, number> = {
  发票: 10,
  收据: 20,
  行程单: 30,
  同行人: 35,
  支付截图: 40,
  销售单: 50,
  送货单: 60,
  清单: 70,
  合同: 80,
  其他: 90,
};

export const CATEGORIES = [
  "物资采购",
  "活动物料",
  "交通差旅",
  "餐饮接待",
  "打印制作",
  "其他",
] as const;

export const DEPARTMENTS = ["行政部", "运营部", "个人"] as const;

export const DEPT_META: Record<
  string,
  { accent: string; soft: string; text: string; en: string }
> = {
  行政部: { accent: "#0F6B60", soft: "#E8F1EF", text: "#0B4F47", en: "INTERNAL AFFAIRS" },
  运营部: { accent: "#B4462F", soft: "#F7EBE7", text: "#8C3322", en: "PUBLICITY" },
  个人: { accent: "#8A6A2F", soft: "#F4EFE2", text: "#6B5124", en: "PERSONAL" },
};

export const TASK_STATUS: Record<string, { label: string; hint: string }> = {
  doing: { label: "待交付", hint: "部员执行中" },
  review: { label: "待你审核", hint: "核对交付成果" },
  done: { label: "已完成", hint: "收尾归档" },
};

export const PROJECT_STATUS: Record<string, string> = {
  idea: "构想",
  active: "进行中",
  paused: "暂停",
  done: "已完结",
};

export const ACTIVITY_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "整理中", color: "#8A6A2F" },
  packaged: { label: "已打包", color: "#0F6B60" },
  submitted: { label: "已提交", color: "#2F5D8A" },
  done: { label: "已归档", color: "#6B7280" },
};

export const DEFAULT_NAMING = "{seq}【{item}-{amount}元】{kind}";

export const ACCEPTED_UPLOAD_TYPES =
  ".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.doc,.docx,.xls,.xlsx";
