import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import jsQR from "jsqr";
import sharp from "sharp";
import JSZip from "jszip";

const directory = await mkdtemp(path.join(tmpdir(), "workbench-account-")), base = "http://127.0.0.1:3942";
const password = randomBytes(20).toString("hex"), nextPassword = randomBytes(20).toString("hex"), username = "test-owner";
let server, log = "";
const pause = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3942", "-H", "127.0.0.1"], {
    env: { ...process.env, WORKBENCH_PASSWORD: "", WORKBENCH_USERNAME: "", WORKBENCH_DATA_DIR: directory, WORKBENCH_PUBLIC_URL: base, TZ: "Asia/Shanghai" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.stdout.on("data", d => log += d); server.stderr.on("data", d => log += d);
  for (let i = 0; i < 80; i++) { if (server.exitCode !== null) throw new Error(log); try { if ((await fetch(`${base}/api/auth/status`)).ok) return; } catch {} await pause(250); }
  throw new Error("Account test server timeout");
}
async function stop() { if (server && server.exitCode === null) { const done = new Promise(r => server.once("exit", r)); server.kill(); await done; } }
function cookie(r, name = "wb_session") {
  return r.headers.getSetCookie().find(s => s.startsWith(`${name}=`))?.split(";")[0] || "";
}
async function req(route, body, session = "", status = 200, extra = {}) {
  const r = await fetch(`${base}/api/${route}`, { method: body === undefined ? "GET" : "POST", headers: { ...(session ? { cookie: session } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(r.status, status, `${route}: ${r.status === status ? "" : await r.text()}`); return r;
}
async function json(...args) { return (await req(...args)).json(); }
async function login(label, trusted = false, pass = password) { return req("auth/login", { username, password: pass, trusted, label }); }
async function newQR() {
  const r = await req("auth/qr/new", { trusted: true, label: "测试电脑" });
  const qr = await r.json(), buffer = Buffer.from(qr.image.split(",")[1], "base64");
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.ok(decoded, "Generated QR must be readable");
  const url = new URL(decoded.data); assert.equal(url.origin, base); assert.equal(url.searchParams.get("login"), "qr");
  const [id, scan] = url.hash.slice(1).split("."); assert.equal(id, qr.id);
  return { qr, id, scan, binding: cookie(r, "wb_pair") };
}
try {
  await start();
  assert.deepEqual(await json("auth/status"), { required: true, initialized: false, needsUsername: false, authed: false });
  for (const route of ["state", "backup", "tasks", "equipment/borrowed"]) await req(route, undefined, "", 401);
  await req("auth/setup", { username, password }, "", 403, { origin: "https://untrusted.invalid" });
  await req("auth/setup", { username, password: "short" }, "", 400);
  await req("auth/login", { username, password }, "", 409);
  const setup = await req("auth/setup", { username, password, trusted: true, label: "主电脑" });
  const owner = cookie(setup); assert.ok(owner);
  assert.match(setup.headers.get("set-cookie"), /HttpOnly/i); assert.match(setup.headers.get("set-cookie"), /SameSite=Lax/i);
  assert.match(setup.headers.get("set-cookie"), /Max-Age=7776000/);
  await req("auth/setup", { username: "attacker", password }, "", 409);
  await req("auth/login", { username: "other", password }, "", 401);
  await req("auth/login", { username, password: "wrong" }, "", 401);
  await req("auth/login", { username, password: password + "x".repeat(220) }, "", 401);
  assert.equal((await json("auth/status", undefined, owner)).authed, true);
  const account = await json("auth/account", undefined, owner);
  assert.equal(account.username, username); assert.equal(account.devices[0].current, true); assert.equal(account.devices[0].trusted, true);
  assert.ok(!JSON.stringify(account).includes("hash"));
  const file = await readFile(path.join(directory, "auth.json"), "utf8");
  assert.ok(!file.includes(password)); assert.ok(!file.includes(owner.split("=")[1]));
  console.log("PASS mandatory authentication, single-owner setup, password hashing, cookie security and device metadata");
  const phoneResponse = await login("测试 iPhone"), phone = cookie(phoneResponse);
  assert.match(phoneResponse.headers.get("set-cookie"), /Max-Age=43200/);
  let p = await newQR();
  assert.equal(p.qr.code.length, 6); assert.ok(p.qr.expiresAt <= Date.now() + 120_000);
  await req("auth/qr/status", { id: p.id }, "", 403);
  await req("auth/qr/inspect", { id: p.id, scan: "wrong" }, "", 403);
  await req("auth/qr/approve", { id: p.id, scan: p.scan, code: p.qr.code, confirmed:true, trusted:true }, "", 401);
  await req("auth/qr/approve", { id: p.id, scan: p.scan, code: "000000" }, phone, 409);
  assert.equal((await json("auth/qr/status", { id: p.id }, p.binding)).status, "waiting");
  assert.equal((await json("auth/qr/inspect", { id: p.id, scan: p.scan })).code, undefined);
  await req("auth/qr/approve", { id: p.id, scan: p.scan, code: p.qr.code, confirmed:true, trusted:true }, phone);
  await req("auth/qr/approve", { id: p.id, scan: p.scan, code: p.qr.code, confirmed:true, trusted:true }, phone, 409);
  const computer = cookie(await req("auth/qr/status", { id: p.id }, p.binding));
  assert.ok(computer); await req("state", undefined, computer);
  await req("auth/qr/status", { id: p.id }, p.binding, 410);
  console.log("PASS readable local QR, authenticated phone confirmation, pairing-code check, browser binding and replay rejection");
  const computerDevice = (await json("auth/account", undefined, owner)).devices.find(d => d.label === "测试电脑");
  await req("auth/devices/revoke", { id: computerDevice.id }, owner);
  await req("state", undefined, computer, 401);
  await req("auth/logout", {}, phone); await req("state", undefined, phone, 401);
  const sample = await json("matters", { title: "登录验证保留的事务", department: "个人" }, owner);
  await stop(); await start(); await req("state", undefined, owner);
  assert.equal((await json("state", undefined, owner)).matters.find(m => m.id === sample.matter.id).title, "登录验证保留的事务");
  const backup = await JSZip.loadAsync(await (await req("backup", undefined, owner)).arrayBuffer());
  assert.ok(!Object.keys(backup.files).some(n => /auth.json|credentials|secrets/.test(n)));
  console.log("PASS immediate device revocation, logout invalidation, restart persistence and credential-free backups");
  p = await newQR();
  const oldSession = cookie(await login("旧浏览器", true));
  await req("auth/password", { current: "wrong", next: nextPassword }, owner, 401);
  const updated = cookie(await req("auth/password", { current: password, next: nextPassword, username }, owner));
  await req("state", undefined, oldSession, 401); await req("state", undefined, owner, 401);
  await req("auth/qr/status", { id: p.id }, p.binding, 410);
  await req("state", undefined, updated);
  await req("auth/login", { username, password }, "", 401);
  const latest = cookie(await login("新浏览器", false, nextPassword));
  // Verify expiry at the same server-side file boundary used after restart.
  const saved = JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8"));
  saved.sessions = saved.sessions.map(s => ({ ...s, expiresAt: new Date(Date.now() - 1000).toISOString() }));
  await writeFile(path.join(directory, "auth.json"), JSON.stringify(saved));
  await req("state", undefined, latest, 401);
  console.log("PASS password rotation revokes other devices and pending QR, expired sessions cannot read data");
  // A real two-minute expiry verifies the production timer without a test bypass.
  p = await newQR();
  await pause(Math.max(1, p.qr.expiresAt - Date.now() + 30));
  await req("auth/qr/status", { id: p.id }, p.binding, 410);
  await req("auth/qr/inspect", { id: p.id, scan: p.scan }, "", 410);
  console.log("PASS QR expiry after two minutes");
  const loginCookie = cookie(await login("限流测试", false, nextPassword));
  for (let i = 0; i < 8; i++) await req("auth/login", { username, password: "wrong" }, "", 401, { "x-forwarded-for": `192.0.2.${i}` });
  await req("auth/login", { username, password: nextPassword }, "", 200, { "x-forwarded-for": "203.0.113.99" });
  await req("state", undefined, loginCookie);
  console.log("PASS failed attempts cannot globally lock the legitimate owner out");
} finally { await stop(); }
