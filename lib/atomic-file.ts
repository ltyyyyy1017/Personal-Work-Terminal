import fs from "node:fs";
import crypto from "node:crypto";
/** Exclusive creation prevents a predictable temporary symlink from being followed. */
export function atomicWrite(file: string, data: string | Uint8Array, mode = 0o600) {
  const temp = `${file}.${crypto.randomBytes(18).toString("hex")}.tmp`;
  try { fs.writeFileSync(temp, data, { flag: "wx", mode }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch { /* already renamed */ } }
}
