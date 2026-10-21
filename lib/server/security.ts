import type { NextRequest } from "next/server";
import { isIP } from "node:net";
import { AppError } from "../errors";
import { verifyPassword } from "../auth";
// Only the local reverse proxy may supply this header. Public backends must bind loopback.
export function sourceKey(req: NextRequest) {
  if (process.env.WORKBENCH_TRUST_PROXY === "true") {
    const ip = req.headers.get("x-workbench-client-ip") || "";
    if (isIP(ip)) return ip;
  }
  return "direct";
}
const failures = new Map<string, { count: number; at: number }>();
const requests = new Map<string, { count: number; at: number }>();
function prune(map: Map<string, { count: number; at: number }>, age: number) {
  const now = Date.now(); for (const [k, v] of map) if (now - v.at > age) map.delete(k);
  if (map.size > 4096) map.delete(map.keys().next().value!);
}
export function limitSource(req: NextRequest, action: string, max: number, windowMs: number) {
  prune(requests, windowMs); const key = `${sourceKey(req)}:${action}`, now = Date.now(), prev = requests.get(key);
  const rec = prev && now - prev.at < windowMs ? prev : { count: 0, at: now };
  if (++rec.count > max) throw new AppError("当前来源请求过多，请稍后重试", 429);
  requests.set(key, rec);
}
let totalFailures = 0, totalAt = 0;
export async function verifyOwner(req: NextRequest, value: unknown) {
  prune(failures, 600_000); const key = sourceKey(req), now = Date.now(), rec = failures.get(key);
  // Check correct credentials before applying a failure delay: another source cannot lock the owner out.
  const ok = verifyPassword(typeof value === "string" ? value : "");
  if (ok) { failures.delete(key); return; }
  if (now - totalAt > 60_000) { totalAt = now; totalFailures = 0; }
  totalFailures++;
  const count = (rec?.count || 0) + 1; failures.set(key, { count, at: now });
  await new Promise(r => setTimeout(r, Math.min(1500, count * 100 + Math.min(totalFailures, 10) * 25)));
  throw new AppError("账号或密码不正确", 401);
}
export async function boundedBody(req: NextRequest, maxBytes: number) {
  const advertised = req.headers.get("content-length");
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes)) throw new AppError("请求内容过大", 413);
  const reader = req.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new AppError("请求内容过大", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
