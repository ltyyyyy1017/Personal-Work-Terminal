import ExcelJS from "exceljs";
import {addIncomeExpenseSheet} from "./income-expense-excel";
import {exportWorkbook} from "./export-traditional";
import type { NamingPlanRow } from "./naming";
import { rmbUpper } from "./naming";
import type { ReimbActivity, Settings } from "./types";
import { fmtDateFull, fmtDateTime } from "./date";
import {isReported,isFunded} from "./reimbursement-progress";

const FONT = "Microsoft YaHei";
const LINE = "FFD9D3C6";
const HEAD_FILL = "FFF1EDE3";
const LABEL_FILL = "FFF7F4EC";
const INK = "FF1F2328";

type Border = Partial<ExcelJS.Borders>;

const thin: Border = {
  top: { style: "thin", color: { argb: LINE } },
  left: { style: "thin", color: { argb: LINE } },
  bottom: { style: "thin", color: { argb: LINE } },
  right: { style: "thin", color: { argb: LINE } },
};

function borderRange(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      ws.getCell(r, c).border = thin;
    }
  }
}

function styleLabel(cell: ExcelJS.Cell, value: string) {
  cell.value = value;
  cell.font = { name: FONT, size: 10.5, color: { argb: INK }, bold: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LABEL_FILL } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

function styleValue(cell: ExcelJS.Cell, value: string | number | null) {
  cell.value = value;
  cell.font = { name: FONT, size: 10.5, color: { argb: INK } };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
}

export interface WorkbookResult {
  buffer: Buffer;
  total: number;
  fileCount: number;
}

export async function buildReimburseWorkbook(opts: {
  matterTitle?: string;
  activity: ReimbActivity;
  settings: Settings;
  plan: NamingPlanRow[];
}): Promise<WorkbookResult> {
  const { activity, settings, plan } = opts;
  const fileById = new Map(activity.files.map((f) => [f.id, f]));
  const itemById = new Map(activity.items.map((i) => [i.id, i]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "个人工作台";
  wb.created = new Date();
  addIncomeExpenseSheet(wb,{department:activity.department,title:opts.matterTitle||activity.name,activities:[activity],settings});

  /* ------------------------------- 报销明细 ------------------------------- */
  const ws = wb.addWorksheet("报销明细", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [
    { width: 5.5 },
    { width: 9 },
    { width: 26 },
    { width: 12 },
    { width: 13 },
    { width: 13 },
    { width: 23 },
    { width: 40 },
    { width: 15 },
  ];

  const totalAmount = activity.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const fileCount = activity.files.length;

  ws.mergeCells("A1:I1");
  const title = ws.getCell("A1");
  title.value = "报 销 材 料 明 细 表";
  title.font = { name: FONT, size: 18, bold: true, color: { argb: INK } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 40;

  ws.mergeCells("A2:I2");
  const sub = ws.getCell("A2");
  sub.value = `${settings.org || "示例组织一"} · ${activity.name}`;
  sub.font = { name: FONT, size: 10.5, color: { argb: "FF6B7075" } };
  sub.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 22;

  styleLabel(ws.getCell("A3"), "报销部门");
  ws.mergeCells("B3:C3");
  styleValue(ws.getCell("B3"), activity.department);
  styleLabel(ws.getCell("D3"), "报销人");
  ws.mergeCells("E3:F3");
  styleValue(ws.getCell("E3"), activity.submitter || "—");
  styleLabel(ws.getCell("G3"), "报销日期");
  styleValue(ws.getCell("H3"), fmtDateFull(activity.date));
  ws.mergeCells("H3:I3");
  borderRange(ws, 3, 1, 3, 9);
  ws.getRow(3).height = 26;

  styleLabel(ws.getCell("A4"), "报销事由");
  ws.mergeCells("B4:F4");
  styleValue(ws.getCell("B4"), activity.reason || activity.name);
  styleLabel(ws.getCell("G4"), "附件");
  ws.mergeCells("H4:I4");
  styleValue(ws.getCell("H4"), `${fileCount} 份材料 / ${activity.items.length} 个事项`);
  borderRange(ws, 4, 1, 4, 9);
  ws.getRow(4).height = 26;

  const headers = ["序号", "编号", "事项", "材料类型", "金额（元）", "开票日期", "发票号码", "文件名", "备注"];
  const headRow = ws.getRow(5);
  headers.forEach((h, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 10.5, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  borderRange(ws, 5, 1, 5, 9);
  headRow.height = 28;

  let row = 6;
  activity.items.forEach((item, itemIdx) => {
    const rows = plan.filter((p) => p.itemId === item.id);
    const span = Math.max(1, rows.length);
    const start = row;
    const end = row + span - 1;
    const itemLabel = item.name || `事项 ${itemIdx + 1}`;

    if (!rows.length) {
      const cells = [
        itemIdx + 1,
        `${itemIdx + 1}-0`,
        itemLabel,
        "材料缺失",
        item.amount,
        "",
        "",
        "—",
        item.note ?? "",
      ];
      cells.forEach((v, ci) => {
        const cell = ws.getCell(start, ci + 1);
        cell.value = v as ExcelJS.CellValue;
        cell.font = { name: FONT, size: 10, color: { argb: INK } };
        cell.alignment = {
          vertical: "middle",
          horizontal: ci === 2 || ci === 7 ? "left" : "center",
          wrapText: true,
        };
      });
      ws.getCell(start, 4).font = { name: FONT, size: 10, color: { argb: "FFB4462F" }, bold: true };
    } else {
      rows.forEach((p, ri) => {
        const file = fileById.get(p.fileId);
        const values: (string | number | null | undefined)[] = [
          ri === 0 ? itemIdx + 1 : null,
          p.seq,
          ri === 0 ? itemLabel : null,
          p.kind,
          ri === 0 ? item.amount : null,
          file?.meta?.issuedAt ?? "",
          file?.meta?.invoiceNo ?? "",
          p.name,
          ri === 0 ? item.note ?? "" : "",
        ];
        values.forEach((v, ci) => {
          const cell = ws.getCell(start + ri, ci + 1);
          cell.value = (v ?? "") as ExcelJS.CellValue;
          cell.font = {
            name: FONT,
            size: 10,
            color: { argb: ci === 7 ? "FF4A4F55" : INK },
          };
          cell.alignment = {
            vertical: "middle",
            horizontal: ci === 2 || ci === 7 || ci === 8 ? "left" : "center",
            wrapText: true,
          };
        });
      });
    }

    if (span > 1) {
      ws.mergeCells(start, 1, end, 1);
      ws.mergeCells(start, 3, end, 3);
      ws.mergeCells(start, 5, end, 5);
    }
    ws.getCell(start, 5).numFmt = '#,##0.00';
    borderRange(ws, start, 1, end, 9);
    for (let r = start; r <= end; r++) ws.getRow(r).height = 27;
    row = end + 1;
  });

  const totalRow = row;
  ws.mergeCells(totalRow, 1, totalRow, 4);
  const totalLabel = ws.getCell(totalRow, 1);
  totalLabel.value = `合计（大写）：${rmbUpper(totalAmount)}`;
  totalLabel.font = { name: FONT, size: 10.5, bold: true, color: { argb: INK } };
  totalLabel.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  const totalCell = ws.getCell(totalRow, 5);
  totalCell.value = Number(totalAmount.toFixed(2));
  totalCell.numFmt = '¥#,##0.00';
  totalCell.font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
  totalCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells(totalRow, 6, totalRow, 9);
  styleValue(ws.getCell(totalRow, 6), `共 ${fileCount} 份材料 · ${activity.items.length} 个事项`);
  borderRange(ws, totalRow, 1, totalRow, 9);
  ws.getRow(totalRow).height = 30;

  const signRow = totalRow + 2;
  ws.mergeCells(signRow, 1, signRow, 3);
  styleValue(ws.getCell(signRow, 1), "报销人（签字）：");
  ws.mergeCells(signRow, 4, signRow, 6);
  styleValue(ws.getCell(signRow, 4), "部门负责人：");
  ws.mergeCells(signRow, 7, signRow, 9);
  styleValue(ws.getCell(signRow, 7), "财务审核：");
  ws.getCell(signRow, 1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  ws.getCell(signRow, 4).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  ws.getCell(signRow, 7).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  ws.getRow(signRow).height = 38;

  const footRow = signRow + 2;
  ws.mergeCells(footRow, 1, footRow, 9);
  const foot = ws.getCell(footRow, 1);
  foot.value = `由个人工作台生成 · ${fmtDateTime(new Date().toISOString())} · 附件与明细一一对应，请勿手改文件名`;
  foot.font = { name: FONT, size: 9, color: { argb: "FF8A8F94" } };
  foot.alignment = { horizontal: "center", vertical: "middle" };

  /* ------------------------------- 报销封面 ------------------------------- */
  const cover = wb.addWorksheet("报销单", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.6, right: 0.6, top: 0.8, bottom: 0.6, header: 0.2, footer: 0.2 },
    },
  });
  cover.columns = [{ width: 16 }, { width: 26 }, { width: 16 }, { width: 26 }];

  cover.mergeCells("A1:D1");
  const coverTitle = cover.getCell("A1");
  coverTitle.value = "报  销  单";
  coverTitle.font = { name: FONT, size: 24, bold: true, color: { argb: INK } };
  coverTitle.alignment = { horizontal: "center", vertical: "middle" };
  cover.getRow(1).height = 54;

  cover.mergeCells("A2:D2");
  const coverSub = cover.getCell("A2");
  coverSub.value = settings.org || "示例组织一";
  coverSub.font = { name: FONT, size: 11, color: { argb: "FF6B7075" } };
  coverSub.alignment = { horizontal: "center", vertical: "middle" };
  cover.getRow(2).height = 24;

  const invoiceCount = activity.files.filter((f) => f.kind === "发票").length;
  const tripCount = activity.files.filter((f) => f.kind === "行程单").length;
  const pairs: [string, string | number][] = [
    ["报销部门", activity.department],
    ["报销人", activity.submitter || ""],
    ["报销日期", fmtDateFull(activity.date)],
    ["联系方式", activity.contact || ""],
    ["经办人", activity.handler || ""],
    ["费用归属", "实际报销人承担的费用"],
  ];
  let r = 4;
  for (let i = 0; i < pairs.length; i += 2) {
    const [l1, v1] = pairs[i];
    const [l2, v2] = pairs[i + 1];
    styleLabel(cover.getCell(r, 1), l1);
    styleValue(cover.getCell(r, 2), v1);
    styleLabel(cover.getCell(r, 3), l2);
    styleValue(cover.getCell(r, 4), v2);
    cover.getRow(r).height = 30;
    r++;
  }

  styleLabel(cover.getCell(r, 1), "报销事由");
  cover.mergeCells(r, 2, r, 4);
  styleValue(cover.getCell(r, 2), activity.reason || activity.name);
  cover.getRow(r).height = 48;
  borderRange(cover, r, 1, r, 4);
  r++;

  styleLabel(cover.getCell(r, 1), "金额（小写）");
  styleValue(cover.getCell(r, 2), `¥ ${totalAmount.toFixed(2)}`);
  cover.getCell(r, 2).numFmt = '"¥ "#,##0.00';
  styleLabel(cover.getCell(r, 3), "金额（大写）");
  styleValue(cover.getCell(r, 4), rmbUpper(totalAmount));
  cover.getRow(r).height = 28;
  borderRange(cover, r, 1, r, 4);
  r++;

  styleLabel(cover.getCell(r, 1), "材料张数");
  styleValue(cover.getCell(r, 2), `${fileCount} 份`);
  styleLabel(cover.getCell(r, 3), "发票 / 行程单");
  styleValue(cover.getCell(r, 4), `${invoiceCount} 张 / ${tripCount} 份`);
  cover.getRow(r).height = 28;
  borderRange(cover, r, 1, r, 4);
  r++;

  for (const [label, value] of [
    ["发票抬头", settings.reimbursement.invoiceTitle],
    ["纳税人识别号", settings.reimbursement.taxId],
    ["备注", activity.note || ""],
  ] as [string, string][]) {
    styleLabel(cover.getCell(r, 1), label);
    cover.mergeCells(r, 2, r, 4);
    styleValue(cover.getCell(r, 2), value);
    cover.getRow(r).height = label === "备注" ? 44 : 28;
    borderRange(cover, r, 1, r, 4);
    r++;
  }

  r += 2;
  const signs: [number, number, string][] = [
    [1, 1, "报销人（签字）："],
    [2, 2, "部门负责人："],
    [3, 4, "财务审核："],
  ];
  signs.forEach(([c1, c2, text]) => {
    cover.mergeCells(r, c1, r, c2);
    styleValue(cover.getCell(r, c1), text);
    cover.getCell(r, c1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  });
  cover.getRow(r).height = 46;

  /* ------------------------------- 行程明细 ------------------------------- */
  const legs = activity.items.flatMap((i) => i.trip ?? []);
  if (legs.length) {
    const trip = wb.addWorksheet("行程明细", {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });
    trip.columns = [
      { width: 6 },
      { width: 14 },
      { width: 12 },
      { width: 14 },
      { width: 18 },
      { width: 18 },
      { width: 12 },
      { width: 24 },
    ];
    trip.mergeCells("A1:H1");
    const t1 = trip.getCell("A1");
    t1.value = "差 旅 行 程 明 细";
    t1.font = { name: FONT, size: 16, bold: true, color: { argb: INK } };
    t1.alignment = { horizontal: "center", vertical: "middle" };
    trip.getRow(1).height = 36;

    const tHead = ["序号", "日期", "交通方式", "班次/车次", "出发地", "到达地", "金额（元）", "备注"];
    tHead.forEach((h, i) => {
      const cell = trip.getCell(2, i + 1);
      cell.value = h;
      cell.font = { name: FONT, size: 10.5, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    borderRange(trip, 2, 1, 2, 8);

    let tr = 3;
    legs.forEach((leg, i) => {
      const vals: (string | number)[] = [
        i + 1,
        leg.date,
        leg.mode,
        leg.code || "",
        leg.from,
        leg.to,
        leg.amount ?? "",
        leg.note || "",
      ];
      vals.forEach((v, ci) => {
        const cell = trip.getCell(tr, ci + 1);
        cell.value = v;
        cell.font = { name: FONT, size: 10 };
        cell.alignment = {
          vertical: "middle",
          horizontal: ci >= 4 && ci <= 5 ? "left" : "center",
          wrapText: true,
        };
      });
      trip.getCell(tr, 7).numFmt = '#,##0.00';
      borderRange(trip, tr, 1, tr, 8);
      trip.getRow(tr).height = 26;
      tr++;
    });
    trip.mergeCells(tr, 1, tr, 6);
    const tripTotalLabel = trip.getCell(tr, 1);
    tripTotalLabel.value = `行程合计（大写）：${rmbUpper(legs.reduce((s, l) => s + (Number(l.amount) || 0), 0))}`;
    tripTotalLabel.font = { name: FONT, size: 10.5, bold: true };
    tripTotalLabel.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    const tripTotal = trip.getCell(tr, 7);
    tripTotal.value = Number(legs.reduce((s, l) => s + (Number(l.amount) || 0), 0).toFixed(2));
    tripTotal.numFmt = '¥#,##0.00';
    tripTotal.font = { name: FONT, size: 11, bold: true };
    tripTotal.alignment = { horizontal: "center", vertical: "middle" };
    borderRange(trip, tr, 1, tr, 8);
    trip.getRow(tr).height = 28;
  }

  const info=wb.addWorksheet("报销信息",{views:[{showGridLines:false}]});
  info.columns=[{width:22},{width:80}];
  const matter=opts.matterTitle||activity.matterId||"未关联";
  const rows=[['报销名称',activity.name],['报销人',activity.submitter],['经办人',activity.handler||'未填写'],['联系方式',activity.contact||'未填写'],['关联事务',matter],['上报状态',isReported(activity)?'已上报':'未上报'],['批款状态',isFunded(activity)?'已批款':'未批款'],...(activity.taxi?[['交通类型','打车'],['出发地',activity.taxi.from||'未填写'],['目的地',activity.taxi.to||'未填写'],['同行人',activity.taxi.companions.join('、')||'无 / 未填写'],['行程单附件',String(activity.files.filter(f=>f.kind==='行程单').length)+' 份']]:[])];
  for(const [key,value] of rows){const r=info.addRow([key,value]);styleLabel(r.getCell(1),key);styleValue(r.getCell(2),value);r.height=30;}
  exportWorkbook(wb,activity.department);
  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf as ArrayBuffer),
    total: Number(totalAmount.toFixed(2)),
    fileCount,
  };
}
