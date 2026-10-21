import fs from "node:fs";
import path from "node:path";
import { mutateStore, newId, nowISO, readStore, dirs, appendLog } from "../../store";
import { json, numOrNull, str } from "../http";
import { AppError, assert } from "../../errors";
import { CATEGORIES, DEPARTMENTS, MAT_KINDS } from "../../constants";
import { isPdfBytes, readPdf } from "../../pdf";
import { parseInvoiceText } from "../../invoice";
import { namingPlan, suggestKind } from "../../naming";
import { analyzeActivity, summarizeChecks } from "../../checks";
import {
  extOf,
  MAX_UPLOAD_BYTES,
  mimeOf,
  readReimburseFile,
  removeReimburseFile,
  saveReimburseFile,
  contentDisposition,
} from "../../files";
import { buildActivity } from "../../build";
import { todayStr } from "../../date";
import {organizationFor,departmentProfiles} from "../../organizations";
import {applyReimbursementFields} from "../reimbursement-fields";
import type { Ctx } from "../ctx";
import type { MatKind, ReimbActivity, ReimbFile, ReimbItem, TripLeg } from "../../types";

function findActivity(store: ReturnType<typeof readStore>, id: string): ReimbActivity {
  const activity = store.activities.find((a) => a.id === id);
  if (!activity) throw new AppError("报销活动不存在", 404);
  return activity;
}

function summarize(a: ReimbActivity) {
  const total = a.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    fileCount: a.files.length,
    itemCount: a.items.length,
  };
}

export async function listActivities() {
  const store = readStore();
  const activities = [...store.activities]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((a) => {
      const checks = analyzeActivity(a, store.settings);
      return {
        ...a,
        summary: summarize(a),
        checkSummary: summarizeChecks(checks),
      };
    });
  const month = todayStr().slice(0, 7);
  const monthTotal = store.activities
    .filter((a) => a.date.startsWith(month))
    .reduce((s, a) => s + a.items.reduce((x, i) => x + (Number(i.amount) || 0), 0), 0);
  return json({
    activities,
    stats: {
      drafts: store.activities.filter((a) => a.status === "draft").length,
      packaged: store.activities.filter((a) => a.status === "packaged").length,
      monthTotal: Math.round(monthTotal * 100) / 100,
      allTotal: Math.round(
        store.activities.reduce(
          (s, a) => s + a.items.reduce((x, i) => x + (Number(i.amount) || 0), 0),
          0,
        ) * 100,
      ) / 100,
    },
  });
}

export async function getActivity(ctx: Ctx) {
  const store = readStore();
  const activity = findActivity(store, ctx.params.id);
  const checks = analyzeActivity(activity, store.settings);
  return json({
    activity,
    checks,
    plan: namingPlan(activity, store.settings.reimbursement.namingTemplate),
    summary: summarize(activity),
  });
}

export async function createActivity(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const name = str(body.name).trim();
  assert(name, "请填写报销活动名称");
  const category = (CATEGORIES as readonly string[]).includes(String(body.category))
    ? (body.category as ReimbActivity["category"])
    : "其他";
  const department = departmentProfiles(readStore().settings).some(p=>p.id===body.department)
    ? (body.department as ReimbActivity["department"])
    : "行政部";
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(body.date ?? ""))
    ? String(body.date).slice(0, 10)
    : todayStr();
  const submitter = str(body.submitter).trim();
  const reason = str(body.reason).trim();
  const amount = numOrNull(body.amount);
  const itemName = str(body.itemName).trim() || name;
  const now = nowISO();

  const activity: ReimbActivity = {
    organization:organizationFor(department,readStore().settings),
    contact:str(body.contact,"",150),
    currency:["CNY","MOP","HKD","TWD","USD"].includes(String(body.currency))?body.currency as ReimbActivity["currency"]:"CNY",
    paidAmount:typeof body.paidAmount==="number"?body.paidAmount:undefined,
    reviewed:body.reviewed===true,
    id: newId("act"),
    name,
    category,
    department,
    date,
    submitter: submitter || "",
    reason: reason || name,
    status: "draft",
    items: [{ id: newId("item"), name: itemName, amount }],
    files: [],
    output: null,
    note: str(body.note).trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((s) => {
    applyReimbursementFields(activity,body,s);
    s.activities.push(activity);
  });
  return json({ activity });
}

export async function patchActivity(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    if (typeof body.name === "string" && body.name.trim()) a.name = str(body.name).trim();
    if ((CATEGORIES as readonly string[]).includes(String(body.category))) {
      a.category = body.category as ReimbActivity["category"];
    }
    if (departmentProfiles(readStore().settings).some(p=>p.id===body.department)) {
      a.department = body.department as ReimbActivity["department"];
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(String(body.date ?? ""))) a.date = String(body.date).slice(0, 10);
    if ("submitter" in body) a.submitter = str(body.submitter).trim();
    if ("reason" in body) a.reason = str(body.reason).trim();
    if ("note" in body) a.note = str(body.note).trim() || undefined;
    a.organization=organizationFor(a.department,s.settings);
    if (["draft", "packaged", "submitted", "done"].includes(String(body.status))) {
      a.status = body.status as ReimbActivity["status"];
    }
    applyReimbursementFields(a,body,s);
    if (Array.isArray(body.itemOrder)) {
      const order = body.itemOrder.map(String);
      a.items.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
    }
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result });
}

export async function deleteActivity(ctx: Ctx) {
  const id = ctx.params.id;
  await mutateStore((s) => {
    const idx = s.activities.findIndex((a) => a.id === id);
    if (idx < 0) throw new AppError("报销活动不存在", 404);
    s.activities.splice(idx, 1);
  });
  try {
    fs.rmSync(path.join(dirs.reimburse, id), { recursive: true, force: true });
    fs.rmSync(path.join(dirs.exports, id), { recursive: true, force: true });
  } catch {
    /* 清理失败不阻塞 */
  }
  return json({ ok: true });
}

/* ---------------------------------- items --------------------------------- */

export async function addItem(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const name = str(body.name).trim() || `事项 ${Date.now() % 1000}`;
  const item: ReimbItem = {
    id: newId("item"),
    name,
    amount: numOrNull(body.amount),
    note: str(body.note).trim() || undefined,
  };
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    assert(a.items.length<200,"每笔报销最多 200 个事项");
    a.items.push(item);
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result, item });
}

export async function patchItem(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    const item = a.items.find((i) => i.id === ctx.params.itemId);
    if (!item) throw new AppError("事项不存在", 404);
    if (typeof body.name === "string") item.name = str(body.name).trim() || item.name;
    if ("amount" in body) item.amount = numOrNull(body.amount);
    if ("note" in body) item.note = str(body.note).trim() || undefined;
    if (Array.isArray(body.trip)) {
      assert(body.trip.length<=100,"每个事项最多 100 段行程");
      item.trip = (body.trip as unknown[])
        .map((t): TripLeg => {
          const leg = t as Record<string, unknown>;
          return {
            id: str(leg.id) || newId("leg"),
            mode: (["高铁", "火车", "飞机", "打车", "公交地铁", "其他"] as const).includes(leg.mode as never)
              ? (leg.mode as TripLeg["mode"])
              : "其他",
            date: /^\d{4}-\d{2}-\d{2}/.test(String(leg.date ?? "")) ? String(leg.date).slice(0, 10) : "",
            from: str(leg.from, "", 60),
            to: str(leg.to, "", 60),
            amount: numOrNull(leg.amount),
            code: str(leg.code, "", 40) || undefined,
            note: str(leg.note, "", 200) || undefined,
          };
        })
        .filter((l) => l.date || l.from || l.to);
    }
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result });
}

export async function deleteItem(ctx: Ctx) {
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    const idx = a.items.findIndex((i) => i.id === ctx.params.itemId);
    if (idx < 0) throw new AppError("事项不存在", 404);
    a.items.splice(idx, 1);
    a.files.forEach((f) => {
      if (f.itemId === ctx.params.itemId) f.itemId = null;
    });
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result });
}

/* ---------------------------------- files --------------------------------- */

export async function uploadFiles(ctx: Ctx) {
  const form = await ctx.form();
  const raw = form.getAll("files").filter((f): f is File => f instanceof File);
  assert(raw.length > 0, "没有收到文件");
  const store = readStore();
  const activity = findActivity(store, ctx.params.id);
  const itemIdInput = String(form.get("itemId") ?? "");
  const itemId =
    activity.items.find((i) => i.id === itemIdInput)?.id ?? activity.items[0]?.id ?? null;
  const kindOverride = String(form.get("kind") ?? "");
  const added: ReimbFile[] = [];

  for (const file of raw) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(`「${file.name}」超过 60MB，请压缩后再上传`, 413);
    }
    if (file.size === 0) continue;
    const id = newId("file");
    const ext = extOf(file.name);
    assert([".pdf",".jpg",".jpeg",".png",".webp"].includes(ext), "报销材料支持 PDF、JPG、PNG 和 WebP");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = mimeOf(file.name);
    const saved = saveReimburseFile(activity.id, id, ext, buf);
    let text = "";
    let pages: number | undefined;
    let meta;
    if (isPdfBytes(buf)) {
      const read = await readPdf(buf);
      text = read.text;
      pages = read.pages || undefined;
      meta = parseInvoiceText(text);
    }
    const autoKind = suggestKind(file.name, text);
    const kind = (MAT_KINDS as readonly string[]).includes(kindOverride)
      ? (kindOverride as MatKind)
      : store.settings.reimbursement.autoClassify
        ? autoKind
        : "其他";
    added.push({
      id,
      itemId,
      originalName: file.name,
      storedName: saved.storedName,
      size: saved.size,
      mime,
      kind,
      order: activity.files.length + added.length,
      pages,
      meta,
      addedAt: nowISO(),
    });
  }

  assert(added.length > 0, "文件内容为空，未保存");
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    a.files.push(...added);
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result, added });
}

export async function patchFile(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    const file = a.files.find((f) => f.id === ctx.params.fileId);
    if (!file) throw new AppError("材料不存在", 404);
    if ((MAT_KINDS as readonly string[]).includes(String(body.kind))) {
      file.kind = body.kind as MatKind;
    }
    if ("itemId" in body) {
      const itemId = String(body.itemId ?? "");
      file.itemId = a.items.some((i) => i.id === itemId) ? itemId : null;
    }
    if ("order" in body && Number.isFinite(Number(body.order))) file.order = Number(body.order);
    if (body.meta && typeof body.meta === "object") {
      const meta = body.meta as Record<string, unknown>;
      file.meta = {...file.meta, amount:numOrNull(meta.amount), invoiceNo:str(meta.invoiceNo,"",500), buyerName:str(meta.buyerName,"",160), buyerTaxId:str(meta.buyerTaxId,"",60)};
      if (typeof meta.issuedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.issuedAt)) file.meta.issuedAt = meta.issuedAt;
      if (typeof meta.sellerName === "string") file.meta.sellerName = str(meta.sellerName,"",160);
      if (typeof meta.sellerTaxId === "string") file.meta.sellerTaxId = str(meta.sellerTaxId,"",60);
      if (typeof meta.invoiceType === "string") file.meta.invoiceType = str(meta.invoiceType,"",60);
      if (["CNY","HKD","MOP","TWD","USD"].includes(String(meta.currency))) file.meta.currency = String(meta.currency);
    }
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result });
}

export async function deleteFile(ctx: Ctx) {
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    const idx = a.files.findIndex((f) => f.id === ctx.params.fileId);
    if (idx < 0) throw new AppError("材料不存在", 404);
    const [removed] = a.files.splice(idx, 1);
    removeReimburseFile(removed.storedName);
    a.updatedAt = nowISO();
    return a;
  });
  return json({ activity: result });
}

export async function serveFile(ctx: Ctx, inline: boolean) {
  const store = readStore();
  let found: ReimbFile | undefined;
  for (const a of store.activities) {
    found = a.files.find((f) => f.id === ctx.params.fileId);
    if (found) break;
  }
  if (!found) throw new AppError("文件不存在", 404);
  const buf = readReimburseFile(found.storedName);
  const type = found.mime || "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": type,
      "content-disposition": contentDisposition(found.originalName, inline),
      "cache-control": "private, max-age=60",
    },
  });
}

/* ---------------------------------- build --------------------------------- */

export async function build(ctx: Ctx) {
  const { activity, output, checks } = await buildActivity(ctx.params.id);
  return json({ activity, output, checks });
}

export async function download(ctx: Ctx) {
  const store = readStore();
  const activity = findActivity(store, ctx.params.id);
  if (!activity.output) throw new AppError("还没有生成打包文件，请先点击「生成材料包」", 404);
  const dir = path.resolve(dirs.root, activity.output.dir);
  if (!dir.startsWith(path.resolve(dirs.exports) + path.sep)) {
    throw new AppError("非法的导出路径", 400);
  }
  const what = ctx.url.searchParams.get("what") ?? "zip";
  const nameParam = ctx.url.searchParams.get("name") ?? "";
  let fileName = activity.output.zipName;
  if (what === "xlsx") fileName = activity.output.xlsxName;
  else if (what === "merged") fileName = activity.output.mergedName ?? "";
  else if (what === "file") fileName = nameParam;
  if (!fileName) throw new AppError("该文件不存在", 404);

  const target = path.resolve(dir, fileName);
  if (!target.startsWith(dir + path.sep)) throw new AppError("非法文件名", 400);
  if (!fs.existsSync(target)) throw new AppError("文件已被清理，请重新生成", 404);
  const buf = fs.readFileSync(target);
  const ext = path.extname(target).toLowerCase();
  const type =
    ext === ".zip"
      ? "application/zip"
      : ext === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : ext === ".pdf"
          ? "application/pdf"
          : "application/octet-stream";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": type,
      "content-disposition": contentDisposition(fileName, false),
      "cache-control": "no-store",
    },
  });
}

export async function activityLog(ctx: Ctx) {
  const store = readStore();
  const activity = findActivity(store, ctx.params.id);
  return json({ log: store.log.filter((l) => l.message.includes(activity.name)).slice(0, 20) });
}

export async function markStatus(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const a = findActivity(s, ctx.params.id);
    if (["draft", "packaged", "submitted", "done"].includes(String(body.status))) {
      a.status = body.status as ReimbActivity["status"];
    }
    a.updatedAt = nowISO();
    appendLog(s, "reimburse", `《${a.name}》状态更新为 ${a.status}`);
    return a;
  });
  return json({ activity: result });
}
