import crypto from "node:crypto";
import os from "node:os";
import QRCode from "qrcode";
import {
  authRequired, getAuth, setPassword, upgradeAccount, verifyPassword, createSession,
  currentSession, readSessionToken, devices, revokeSession, revokeToken,
  SESSION_COOKIE, cookieOptions, hashToken,
} from "../../auth";
import { AppError, assert } from "../../errors";
import { json, str } from "../http";
import type { Ctx } from "../ctx";
import type { NextRequest } from "next/server";
import {verifyOwner,sourceKey,limitSource} from "../security";

function token(req: NextRequest) { return req.cookies.get(SESSION_COOKIE)?.value; }
function label(ctx: Ctx, body: Record<string, unknown>) {
  const supplied = str(body.label, "", 80).trim();
  if (supplied) return supplied;
  const ua = ctx.req.headers.get("user-agent") || "";
  return /iPhone/.test(ua) ? "我的 iPhone" : /iPad/.test(ua) ? "我的 iPad" : /Macintosh/.test(ua) ? "我的 Mac" : "我的电脑";
}
export function signedIn(name: string, trusted: boolean, passkeyId?: string) {
  const s = createSession(name, trusted, passkeyId), res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, s.cookie, cookieOptions(s.maxAge));
  return res;
}
function username(value: unknown) {
  const name = str(value, "", 60).trim();
  assert(/^[\p{L}\p{N}_.@-]{2,40}$/u.test(name), "账号需为 2–40 位字母、文字、数字或 _.@-");
  return name;
}
function password(value: unknown) {
  assert(typeof value === "string" && value.length >= 10 && value.length <= 200, "密码请使用 10–200 个字符");
  return value as string;
}
// Account-wide throttling cannot be bypassed by forging a forwarding header.
async function verify(ctx:Ctx,current:string){await verifyOwner(ctx.req,current);}
export function authStatus(req: NextRequest) {
  const auth = getAuth(), authed = readSessionToken(token(req));
  return json({ required: true, initialized: Boolean(auth), needsUsername: Boolean(auth && !auth.username), authed,
    ...(authed ? { username: auth?.username || "主账号" } : {}) });
}
export async function setup(ctx: Ctx) {
  // The default service binds loopback. LAN launcher refuses to start before setup.
  let host="";try{host=new URL(`http://${ctx.req.headers.get("host")||""}`).hostname;}catch{}
  assert(process.env.WORKBENCH_LOCK_SETUP!=="true"&&["127.0.0.1", "localhost", "[::1]"].includes(host), "云端禁止网页初始化，请在本机创建主账号或由管理员恢复账号文件", 403);
  const body = await ctx.body();
  assert(!authRequired(), "主账号已经创建，请直接登录", 409);
  const name = username(body.username), pass = password(body.password);
  setPassword(pass, name);
  return signedIn(label(ctx, body), body.trusted === true);
}
export async function login(ctx: Ctx) {
  const body = await ctx.body(), auth = getAuth();
  assert(auth, "请先在本机创建主账号", 409);
  const pass = str(body.password, "", 201);
  await verify(ctx,pass);
  if (auth.username && str(body.username, "", 60).trim() !== auth.username) {
    throw new AppError("账号或密码不正确", 401);
  }
  if (!auth.username) upgradeAccount(username(body.username || "owner"));
  return signedIn(label(ctx, body), body.trusted === true);
}
export function logout(ctx: Ctx) {
  revokeToken(token(ctx.req));
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
}
export async function changePassword(ctx: Ctx) {
  const body = await ctx.body(); await verify(ctx,str(body.current, "", 201));
  const next = password(body.next), auth = getAuth()!;
  const previous = currentSession(token(ctx.req));
  setPassword(next, body.username ? username(body.username) : auth.username || "owner");
  return signedIn(previous?.label || label(ctx, body), previous?.trusted || false);
}
export function account(ctx: Ctx) { return json({ username: getAuth()?.username, devices: devices(token(ctx.req)) }); }
export async function revoke(ctx: Ctx) {
  const body = await ctx.body(), id = str(body.id, "", 80);
  assert(id, "请选择设备"); revokeSession(id);
  return json({ ok: true });
}

const PAIR_COOKIE = "wb_pair";
interface Pair {
  id: string; scanHash: string; browserHash: string; code: string; label: string;
  trusted: boolean; expiresAt: number; approved: boolean; ownerHash: string;
  source:string;createdAt:string;attempts:number;
}
const g = globalThis as unknown as { __wbPairs?: Map<string, Pair> };
function pairs() {
  const map = g.__wbPairs ??= new Map<string, Pair>();
  for (const [id, p] of map) if (p.expiresAt <= Date.now()) map.delete(id);
  return map;
}
function phoneBase(ctx: Ctx) {
  const configured = process.env.WORKBENCH_PUBLIC_URL;
  if (configured) {
    const url = new URL(configured);
    assert(["http:", "https:"].includes(url.protocol) && !url.username && !url.password, "WORKBENCH_PUBLIC_URL 配置不正确");
    return { url: url.origin, ready: true };
  }
  const addresses = Object.entries(os.networkInterfaces()).filter(([name]) => !/virtual|vmware|vbox|host.only|本地连接\*/i.test(name))
    .flatMap(([, list]) => list || []).filter(a => a.family === "IPv4" && !a.internal);
  const ip = addresses.find(a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;
  return { url: ip ? `http://${ip}:${ctx.url.port || "3939"}` : "", ready: process.env.WORKBENCH_LAN === "true" && Boolean(ip) };
}
export function qrInfo(ctx: Ctx) { return json(phoneBase(ctx)); }
export async function qrNew(ctx: Ctx) {
  limitSource(ctx.req,"qr-new",12,120_000);
  assert(getAuth()?.username, "请先创建主账号后使用扫码登录", 409);
  const base = phoneBase(ctx);
  assert(base.ready, "手机扫码需要开启局域网访问：在电脑上运行「启动手机扫码.cmd」", 409);
  const body = await ctx.body(), map = pairs();
  const previous = ctx.req.cookies.get(PAIR_COOKIE)?.value;
  if (previous) for (const [id, p] of map) if (p.browserHash === hashToken(previous)) map.delete(id);
  const source=sourceKey(ctx.req),own=[...map.entries()].filter(([,p])=>p.source===source);
  while(own.length>=3){map.delete(own.shift()![0]);}
  if(map.size>=256)map.delete(map.keys().next().value!);
  const id = crypto.randomBytes(18).toString("base64url"), scan = crypto.randomBytes(24).toString("base64url"), browser = crypto.randomBytes(32).toString("base64url");
  const p: Pair = { id, scanHash: hashToken(scan), browserHash: hashToken(browser), code: crypto.randomInt(100000, 1000000).toString(),
    label: label(ctx, body), trusted: false, source,createdAt:new Date().toISOString(),attempts:0,expiresAt: Date.now() + 120_000, approved: false, ownerHash: getAuth()!.hash };
  map.set(id, p);
  const url = `${base.url}/?login=qr#${id}.${scan}`;
  const res = json({ id, code: p.code, expiresAt: p.expiresAt, image: await QRCode.toDataURL(url, { width: 272, margin: 2, errorCorrectionLevel: "M" }), url: base.url });
  res.cookies.set(PAIR_COOKIE, browser, cookieOptions(120));
  return res;
}
function pair(body: Record<string, unknown>, phone: boolean, ctx: Ctx) {
  const p = pairs().get(str(body.id, "", 80));
  assert(p && p.ownerHash === getAuth()?.hash, "二维码已失效，请在电脑上刷新二维码", 410);
  const secret = phone ? str(body.scan, "", 100) : ctx.req.cookies.get(PAIR_COOKIE)?.value;
  assert(secret && hashToken(secret) === (phone ? p.scanHash : p.browserHash), "此二维码不属于当前设备", 403);
  return p;
}
export async function qrInspect(ctx: Ctx) {
  const p = pair(await ctx.body(), true, ctx);
  return json({ label: p.label, source:p.source,createdAt:p.createdAt,expiresAt: p.expiresAt });
}
export async function qrApprove(ctx: Ctx) {
  const body = await ctx.body(), p = pair(body, true, ctx);
  assert(!p.approved,"配对码已经确认",409);
  if(typeof body.code!=="string"||body.code!==p.code){if(++p.attempts>=5)pairs().delete(p.id);throw new AppError("配对码不匹配，请输入电脑屏幕上的六位数字",409);}
  assert(body.confirmed===true,"请确认这是你正在使用的电脑",400);p.trusted=body.trusted===true;
  p.approved = true;
  return json({ ok: true });
}
export async function qrPoll(ctx: Ctx) {
  const p = pair(await ctx.body(), false, ctx);
  if (!p.approved) return json({ status: "waiting" });
  pairs().delete(p.id);
  const res = signedIn(p.label, p.trusted);
  res.cookies.set(PAIR_COOKIE, "", cookieOptions(0));
  return res;
}
