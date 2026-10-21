import crypto from "node:crypto";
import fs from "node:fs";
import { atomicWrite } from "./atomic-file";
import { AUTH_PATH, ensureDirs } from "./store";

export const SESSION_COOKIE = "wb_session";
export interface DeviceSession {
  id: string; hash: string; label: string; trusted: boolean;
  createdAt: string; lastSeenAt: string; expiresAt: string;
  passkeyId?: string;
}
export interface PasskeyRecord {
  id: string; publicKey: string; counter: number; transports: string[]; rpId: string;
  label: string; createdAt: string; lastUsedAt?: string; backedUp: boolean;
}
interface AuthFile {
  version: 1 | 2; username?: string; salt: string; hash: string;
  secret: string; createdAt: string; sessions?: DeviceSession[];
  userId?: string; passkeys?: PasskeyRecord[];
}
// Only a genuinely absent credential file permits initial setup.
export function getAuth(): AuthFile | null {
  if (!fs.existsSync(AUTH_PATH)) return null;
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) as AuthFile;
  if (!auth.hash || !auth.salt || ![1, 2].includes(auth.version)) throw new Error("账号文件损坏，请从服务器备份恢复");
  return auth;
}
function save(auth: AuthFile) {
  ensureDirs();
  atomicWrite(AUTH_PATH, JSON.stringify(auth,null,2));
}
export function authRequired() { return Boolean(getAuth()); }
export function hashToken(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }
function hashPassword(password: string, salt: string) { return crypto.scryptSync(password, salt, 64).toString("hex"); }
export function setPassword(password: string, username?: string) {
  const previous = getAuth(), salt = crypto.randomBytes(16).toString("hex");
  save({ version: username || previous?.username ? 2 : 1, username: username || previous?.username,
    salt, hash: hashPassword(password, salt), secret: crypto.randomBytes(32).toString("hex"),
    createdAt: previous?.createdAt || new Date().toISOString(), sessions: [],
    userId: previous?.userId || crypto.randomBytes(32).toString("base64url"), passkeys: previous?.passkeys || [] });
}
export function verifyPassword(password: string) {
  const auth = getAuth();
  if (!auth || typeof password !== "string" || password.length > 200) return false;
  const expected = Buffer.from(auth.hash, "hex"), actual = Buffer.from(hashPassword(password, auth.salt), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
export function upgradeAccount(username: string) {
  const auth = getAuth();
  if (!auth) throw new Error("尚未创建账号");
  save({ ...auth, version: 2, username, sessions: [], secret: crypto.randomBytes(32).toString("hex") });
}
export function createSession(label = "浏览器", trusted = false, passkeyId?: string) {
  const auth = getAuth();
  if (!auth) throw new Error("尚未创建账号");
  const cookie = crypto.randomBytes(32).toString("base64url");
  const maxAge = trusted ? 90 * 86400 : 12 * 3600, now = new Date().toISOString();
  const device: DeviceSession = { id: crypto.randomUUID(), hash: hashToken(cookie), label: label.slice(0, 80), trusted, passkeyId,
    createdAt: now, lastSeenAt: now, expiresAt: new Date(Date.now() + maxAge * 1000).toISOString() };
  auth.sessions = [...(auth.sessions || []).filter(s => Date.parse(s.expiresAt) > Date.now()).slice(-19), device];
  save(auth);
  return { cookie, maxAge, id: device.id };
}
export function currentSession(token?: string | null) {
  if (!token || token.length > 200) return undefined;
  const auth = getAuth(), hash = hashToken(token);
  const session = auth?.sessions?.find(s => s.hash === hash && Date.parse(s.expiresAt) > Date.now());
  if (session && auth && Date.now() - Date.parse(session.lastSeenAt) > 300_000) {
    session.lastSeenAt = new Date().toISOString(); save(auth);
  }
  return session;
}
export function readSessionToken(token?: string | null) { return Boolean(currentSession(token)); }
export function devices(token?: string | null) {
  const current = currentSession(token)?.id;
  return (getAuth()?.sessions || []).filter(s => Date.parse(s.expiresAt) > Date.now())
    .map(({ hash: _hash, ...s }) => ({ ...s, current: s.id === current }));
}
export function revokeSession(id: string) {
  const auth = getAuth(); if (!auth) return;
  auth.sessions = (auth.sessions || []).filter(s => s.id !== id); save(auth);
}
export function revokeToken(token?: string | null) { const s = currentSession(token); if (s) revokeSession(s.id); }
export function passkeyUserId() {
  const auth = getAuth(); if (!auth) throw new Error("尚未创建账号");
  if (!auth.userId) { auth.userId = crypto.randomBytes(32).toString("base64url"); save(auth); }
  return auth.userId;
}
export function addPasskey(record: PasskeyRecord) {
  const auth = getAuth(); if (!auth) throw new Error("尚未创建账号");
  const records = auth.passkeys || [];
  if (records.length >= 10 || records.some(p => p.id === record.id)) throw new Error("该密钥已绑定，或已达到 10 个密钥上限");
  auth.passkeys = [...records, record]; save(auth);
}
export function usePasskey(id: string, counter: number, backedUp: boolean) {
  const auth = getAuth(), p = auth?.passkeys?.find(p => p.id === id);
  if (!auth || !p) throw new Error("通行密钥已被移除");
  if (counter > 0 && counter <= p.counter) throw new Error("通行密钥计数校验失败，请重新登录");
  p.counter = counter; p.backedUp = backedUp; p.lastUsedAt = new Date().toISOString(); save(auth);
}
export function removePasskey(id: string) {
  const auth = getAuth(); if (!auth) return;
  auth.passkeys = (auth.passkeys || []).filter(p => p.id !== id);
  auth.sessions = (auth.sessions || []).filter(s => s.passkeyId !== id); save(auth);
}
export function cookieOptions(maxAge?: number) {
  const https=process.env.WORKBENCH_PUBLIC_URL?.startsWith("https://")===true;
  return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge, secure: https||process.env.WORKBENCH_SECURE_COOKIE === "true" };
}
export function generateToken() {
  const raw = crypto.randomBytes(20).toString("hex"), token = `wb_${raw}`;
  return { token, hash: hashToken(token), prefix: `wb_${raw.slice(0, 6)}` };
}
