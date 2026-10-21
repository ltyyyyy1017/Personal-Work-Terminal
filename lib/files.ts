import fs from "node:fs";
import path from "node:path";
import { dirs } from "./store";
import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function extOf(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return ext || ".bin";
}

export function mimeOf(name: string): string {
  return MIME_BY_EXT[extOf(name)] ?? "application/octet-stream";
}

export function resolveInside(base: string, relative: string): string {
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep) && target !== path.resolve(base)) {
    throw new AppError("非法文件路径", 400);
  }
  let current=path.resolve(base);try{if(fs.lstatSync(current).isSymbolicLink())throw new AppError("不允许通过符号链接访问文件",400);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}for(const part of path.relative(current,target).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw new AppError("不允许通过符号链接访问文件",400);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
  return target;
}

export function saveReimburseFile(
  activityId: string,
  fileId: string,
  ext: string,
  bytes: Uint8Array,
): { storedName: string; size: number } {
  if(!/^[\w-]+$/.test(activityId)||!/^[\w-]+$/.test(fileId)||![".pdf",".jpg",".jpeg",".png",".webp",".txt"].includes(ext))throw new AppError("非法文件参数",400);
  const dir = resolveInside(dirs.reimburse, activityId);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${activityId}/${fileId}${ext}`;
  fs.writeFileSync(resolveInside(dirs.reimburse, storedName), bytes,{flag:"wx",mode:0o600});
  return { storedName, size: bytes.byteLength };
}

export function readReimburseFile(storedName: string): Buffer {
  const p = resolveInside(dirs.reimburse, storedName);
  if (!fs.existsSync(p)) throw new AppError("文件不存在", 404);
  return fs.readFileSync(p);
}

export function removeReimburseFile(storedName: string) {
  try {
    fs.unlinkSync(resolveInside(dirs.reimburse, storedName));
  } catch {
    /* 已不存在 */
  }
}

export function saveDocFile(
  folder: "shared" | "archive",
  id: string,
  ext: string,
  bytes: Uint8Array,
): { storedName: string; size: number } {
  if(!["shared","archive"].includes(folder)||!/^[\w-]+$/.test(id)||!Object.hasOwn(MIME_BY_EXT,ext))throw new AppError("非法文件参数",400);
  const dir = resolveInside(dirs.docs, folder);
  fs.mkdirSync(dir, { recursive: true });
  const storedName = `${folder}/${id}${ext}`;
  fs.writeFileSync(resolveInside(dirs.docs, storedName), bytes,{flag:"wx",mode:0o600});
  return { storedName, size: bytes.byteLength };
}

export function readDocFile(storedName: string): Buffer {
  const p = resolveInside(dirs.docs, storedName);
  if (!fs.existsSync(p)) throw new AppError("文件不存在", 404);
  return fs.readFileSync(p);
}

export function removeDocFile(storedName: string) {
  try {
    fs.unlinkSync(resolveInside(dirs.docs, storedName));
  } catch {
    /* ignore */
  }
}

export function contentDisposition(name: string, inline = false): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
