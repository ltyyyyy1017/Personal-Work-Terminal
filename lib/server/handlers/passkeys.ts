import crypto from "node:crypto";
import { isIP } from "node:net";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getAuth, passkeyUserId, addPasskey, usePasskey, removePasskey, currentSession, hashToken, SESSION_COOKIE, cookieOptions, verifyPassword } from "../../auth";
import { assert, AppError } from "../../errors";
import { json, str } from "../http";
import { signedIn } from "./account";
import type { Ctx } from "../ctx";
import {verifyOwner,limitSource,sourceKey} from "../security";

const COOKIE = "wb_webauthn";
interface Challenge {
  value: string; type: "register" | "login"; origin: string; rpId: string; expires: number;
  ownerHash: string; sessionId?: string; label: string; trusted: boolean;
  source?:string;
}
const g = globalThis as unknown as { __wbWebAuthn?: Map<string, Challenge> };
function pending() {
  const map = g.__wbWebAuthn ??= new Map<string, Challenge>();
  for (const [id, c] of map) if (c.expires <= Date.now()) map.delete(id);
  return map;
}
function relyingParty(ctx: Ctx) {
  const host = ctx.req.headers.get("host") || ctx.url.host;
  if (/^localhost(?::\d+)?$/.test(host)) return { rpId: "localhost", origin: `http://${host}` };
  if (process.env.WORKBENCH_PUBLIC_URL) {
    const url = new URL(process.env.WORKBENCH_PUBLIC_URL);
    if (url.protocol === "https:" && !isIP(url.hostname.replace(/^\[|\]$/g, "")) && host === url.host) return { rpId: url.hostname, origin: url.origin };
  }
  return null;
}
function rp(ctx: Ctx) {
  const config = relyingParty(ctx);
  assert(config, "通行密钥需要 HTTPS 域名；本机请用 localhost 地址打开工作台", 400);
  return config;
}
export function status(ctx: Ctx) {
  const config = relyingParty(ctx);
  return json({ available: Boolean(config), rpId: config?.rpId,
    localUrl: ["127.0.0.1", "[::1]"].includes(ctx.url.hostname) ? `http://localhost:${ctx.url.port || "3939"}${ctx.url.pathname.includes("/api/") ? "/" : ctx.url.pathname}` : null,
    count: (getAuth()?.passkeys || []).filter(p => p.rpId === config?.rpId).length });
}
export function list(ctx: Ctx) {
  return json({ passkeys: (getAuth()?.passkeys || []).map(({ publicKey: _key, counter: _counter, transports: _transports, ...rest }) => rest) });
}
function challengeResponse(options: { challenge: string }, c: Omit<Challenge, "value" | "expires" | "ownerHash">, ctx: Ctx) {
  const map = pending(), previous = ctx.req.cookies.get(COOKIE)?.value;
  if (previous) map.delete(hashToken(previous));
  const source=sourceKey(ctx.req),own=[...map.entries()].filter(([,v])=>v.source===source);while(own.length>=3)map.delete(own.shift()![0]);
  if(map.size>=128)map.delete(map.keys().next().value!);
  const key = crypto.randomBytes(32).toString("base64url");
  map.set(hashToken(key), { ...c,source,value: options.challenge, expires: Date.now() + 120_000, ownerHash: getAuth()!.hash });
  const res = json(options); res.cookies.set(COOKIE, key, cookieOptions(120)); return res;
}
function consume(ctx: Ctx, type: Challenge["type"]) {
  const raw = ctx.req.cookies.get(COOKIE)?.value, key = raw && hashToken(raw), map = pending(), c = key ? map.get(key) : undefined;
  if (key) map.delete(key);
  assert(c && c.type === type && c.ownerHash === getAuth()?.hash, "验证请求已过期，请重试", 410);
  const config = rp(ctx);
  assert(config.origin === c.origin && config.rpId === c.rpId, "验证地址不匹配", 403);
  if (type === "register") assert(currentSession(ctx.req.cookies.get(SESSION_COOKIE)?.value)?.id === c.sessionId, "请重新登录后绑定密钥", 401);
  return c;
}
async function ownerPassword(ctx:Ctx,current:unknown){await verifyOwner(ctx.req,current);}
export async function registrationOptions(ctx: Ctx) {
  const config = rp(ctx), body = await ctx.body(); await ownerPassword(ctx,body.current);
  const auth = getAuth()!;
  assert((auth.passkeys || []).length < 10, "最多可绑定 10 个通行密钥");
  const options = await generateRegistrationOptions({ rpName: "个人工作台", rpID: config.rpId,
    userID: new Uint8Array(Buffer.from(passkeyUserId(), "base64url")), userName: auth.username!,
    attestationType: "none", timeout: 120_000, supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: (auth.passkeys || []).filter(p => p.rpId === config.rpId).map(p => ({ id: p.id, transports: p.transports })),
  });
  return challengeResponse(options, { ...config, type: "register", label: str(body.label, "iCloud / 通行密钥", 80), trusted: false,
    sessionId: currentSession(ctx.req.cookies.get(SESSION_COOKIE)?.value)!.id }, ctx);
}
export async function registrationVerify(ctx: Ctx) {
  const body = await ctx.body(), c = consume(ctx, "register");
  try {
    const verification = await verifyRegistrationResponse({ response: body.credential as RegistrationResponseJSON,
      expectedChallenge: c.value, expectedOrigin: c.origin, expectedRPID: c.rpId, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
    assert(verification.verified && verification.registrationInfo, "无法验证通行密钥");
    assert(getAuth()?.hash === c.ownerHash && currentSession(ctx.req.cookies.get(SESSION_COOKIE)?.value)?.id === c.sessionId, "登录状态已变化，请重新绑定", 401);
    const info = verification.registrationInfo, cred = info.credential;
    addPasskey({ id: cred.id, publicKey: Buffer.from(cred.publicKey).toString("base64url"), counter: cred.counter,
      transports: cred.transports || [], rpId: c.rpId, label: c.label, createdAt: new Date().toISOString(), backedUp: info.credentialBackedUp });
    const res = json({ ok: true }); res.cookies.set(COOKIE, "", cookieOptions(0)); return res;
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError("通行密钥验证失败，请重新尝试绑定", 400); }
}
export async function authenticationOptions(ctx: Ctx) {
  limitSource(ctx.req,"passkey-options",12,120_000);
  const config = rp(ctx), body = await ctx.body(), auth = getAuth();
  assert(auth?.username, "请先创建主账号", 409);
  const keys = (auth.passkeys || []).filter(p => p.rpId === config.rpId);
  assert(keys.length, "请先用账号密码登录，在设置里绑定通行密钥", 409);
  const options = await generateAuthenticationOptions({ rpID: config.rpId, timeout: 120_000, userVerification: "required",
    allowCredentials: keys.map(p => ({ id: p.id, transports: p.transports })) });
  return challengeResponse(options, { ...config, type: "login", label: str(body.label, "通行密钥登录的设备", 80), trusted: body.trusted === true }, ctx);
}
export async function authenticationVerify(ctx: Ctx) {
  const body = await ctx.body(), c = consume(ctx, "login"), response = body.credential as AuthenticationResponseJSON;
  const key = (getAuth()?.passkeys || []).find(p => p.id === response?.id && p.rpId === c.rpId);
  assert(key, "通行密钥未绑定或已经移除", 401);
  assert(!response.response?.userHandle || response.response.userHandle === getAuth()?.userId, "通行密钥账号不匹配", 401);
  try {
    const result = await verifyAuthenticationResponse({ response, expectedChallenge: c.value, expectedOrigin: c.origin,
      expectedRPID: c.rpId, credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter, transports: key.transports as never }, requireUserVerification: true });
    assert(result.verified && getAuth()?.hash === c.ownerHash, "通行密钥登录失败", 401);
    usePasskey(key.id, result.authenticationInfo.newCounter, result.authenticationInfo.credentialBackedUp);
    const res = signedIn(c.label, c.trusted, key.id); res.cookies.set(COOKIE, "", cookieOptions(0)); return res;
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError("通行密钥验证失败，请重试或使用账号密码登录", 401); }
}
export async function remove(ctx: Ctx) {
  const body = await ctx.body(); await ownerPassword(ctx,body.current);
  removePasskey(str(body.id, "", 2048)); return json({ ok: true });
}
