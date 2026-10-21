import { appendLog, dirs, mutateStore, newId, nowISO, readStore } from "../../store";
import { json, str } from "../http";
import { AppError, assert } from "../../errors";
import {
  contentDisposition,
  extOf,
  MAX_UPLOAD_BYTES,
  mimeOf,
  readDocFile,
  removeDocFile,
  saveDocFile,
} from "../../files";
import type { Ctx } from "../ctx";
import type { DocFile } from "../../types";

export async function listDocs(ctx: Ctx) {
  const store = readStore();
  const folder = ctx.url.searchParams.get("folder");
  const q = (ctx.url.searchParams.get("q") ?? "").toLowerCase();
  const docs = store.docs
    .filter((d) => (folder === "shared" || folder === "archive" ? d.folder === folder : true))
    .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return json({
    docs,
    stats: {
      shared: store.docs.filter((d) => d.folder === "shared").length,
      archive: store.docs.filter((d) => d.folder === "archive").length,
      size: store.docs.reduce((s, d) => s + d.size, 0),
    },
  });
}

export async function uploadDocs(ctx: Ctx) {
  const form = await ctx.form();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  assert(files.length, "没有收到文件");
  const folder = form.get("folder") === "archive" ? "archive" : "shared";
  const note = str(form.get("note"), "", 300);
  const added: DocFile[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError(`「${file.name}」超过 60MB`, 413);
    assert([".pdf",".jpg",".jpeg",".png",".webp",".gif",".txt",".doc",".docx",".xls",".xlsx"].includes(extOf(file.name)), "支持上传 PDF、图片、文本、Word 与 Excel 文件");
    const id = newId("doc");
    const buf = Buffer.from(await file.arrayBuffer());
    const saved = saveDocFile(folder, id, extOf(file.name), buf);
    added.push({
      id,
      name: file.name.slice(0, 180),
      storedName: saved.storedName,
      size: saved.size,
      mime: mimeOf(file.name),
      folder,
      note: note || undefined,
      addedAt: nowISO(),
    });
  }
  await mutateStore((s) => {
    s.docs.push(...added);
    appendLog(s, "doc", `上传 ${added.length} 个共享文档`);
  });
  return json({ added });
}

export async function patchDoc(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const doc = s.docs.find((d) => d.id === ctx.params.id);
    if (!doc) throw new AppError("文档不存在", 404);
    if (typeof body.name === "string" && body.name.trim()) doc.name = str(body.name).trim().slice(0, 180);
    if ("note" in body) doc.note = str(body.note, "", 300) || undefined;
    if (body.folder === "shared" || body.folder === "archive") doc.folder = body.folder;
    return doc;
  });
  return json({ doc: result });
}

export async function deleteDoc(ctx: Ctx) {
  await mutateStore((s) => {
    const idx = s.docs.findIndex((d) => d.id === ctx.params.id);
    if (idx < 0) throw new AppError("文档不存在", 404);
    const [removed] = s.docs.splice(idx, 1);
    removeDocFile(removed.storedName);
  });
  return json({ ok: true });
}

export async function downloadDoc(ctx: Ctx) {
  const store = readStore();
  const doc = store.docs.find((d) => d.id === ctx.params.id);
  if (!doc) throw new AppError("文档不存在", 404);
  const buf = readDocFile(doc.storedName);
  const inline = ctx.url.searchParams.get("inline") === "1";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": doc.mime || "application/octet-stream",
      "content-disposition": contentDisposition(doc.name, inline),
      "cache-control": "private, max-age=60",
    },
  });
}

export function docsRoot() {
  return dirs.docs;
}
