import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
const directory = await mkdtemp(path.join(tmpdir(), "workbench-passkeys-"));
const base = "http://127.0.0.1:3944", origin = "http://localhost:3944", username = "passkey-test", password = crypto.randomBytes(20).toString("hex"), replacement = crypto.randomBytes(20).toString("hex");
const hash = b => crypto.createHash("sha256").update(b).digest(), b64 = b => Buffer.from(b).toString("base64url");
let server, log = "";
const pause = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3944", "-H", "127.0.0.1"], { env: { ...process.env, WORKBENCH_DATA_DIR: directory, WORKBENCH_USERNAME: username, WORKBENCH_PASSWORD: password, WORKBENCH_PUBLIC_URL: "" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", d => log += d); server.stderr.on("data", d => log += d);
  for (let i = 0; i < 80; i++) { if (server.exitCode !== null) throw new Error(log); try { if ((await fetch(`${base}/api/auth/status`)).ok) return; } catch {} await pause(250); }
  throw new Error("Passkey test server timeout");
}
async function stop() { if (server && server.exitCode === null) { const done = new Promise(r => server.once("exit", r)); server.kill(); await done; } }
function cookie(res, key = "wb_session") { return res.headers.getSetCookie().find(s => s.startsWith(`${key}=`))?.split(";")[0] || ""; }
async function req(route, body, session = "", status = 200, host = "localhost:3944") {
  const res = await fetch(`http://${host}/api/auth/${route}`, { method: body === undefined ? "GET" : "POST", headers: { host, origin: `http://${host}`, ...(session ? { cookie: session } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(res.status, status, `${route}: ${res.status === status ? "" : await res.text()}`); return res;
}
function authenticator() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }), jwk = publicKey.export({ format: "jwk" });
  const id = crypto.randomBytes(32), cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]]));
  const cred = (options, { registration = false, uv = true, wrongOrigin = false, wrongRP = false, wrongChallenge = false, counter = 1, badSignature = false, wrongUser = false } = {}) => {
    const client = Buffer.from(JSON.stringify({ type: registration ? "webauthn.create" : "webauthn.get", challenge: wrongChallenge ? "invalid" : options.challenge, origin: wrongOrigin ? "https://phishing.invalid" : origin, crossOrigin: false }));
    const count = Buffer.alloc(4); count.writeUInt32BE(registration ? 0 : counter);
    const header = Buffer.concat([hash(wrongRP ? "evil.invalid" : "localhost"), Buffer.from([(registration ? 0x40 : 0) | 1 | (uv ? 4 : 0)]), count]);
    let response;
    if (registration) {
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const authData = Buffer.concat([header, Buffer.alloc(16), len, id, Buffer.from(cose)]);
      const attestationObject = isoCBOR.encode(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]));
      response = { clientDataJSON: b64(client), attestationObject: b64(attestationObject), transports: ["internal", "hybrid"] };
    } else {
      const signature = crypto.sign("sha256", Buffer.concat([header, hash(client)]), privateKey);
      if (badSignature) signature[signature.length - 1] ^= 0x01;
      response = { clientDataJSON: b64(client), authenticatorData: b64(header), signature: b64(signature), userHandle: wrongUser ? "wrong-user" : userId };
    }
    return { id: b64(id), rawId: b64(id), type: "public-key", response, clientExtensionResults: {}, authenticatorAttachment: "platform" };
  };
  return { cred, id: b64(id), privateKey };
}
let owner, userId;
async function registration() { const r = await req("passkeys/register/options", { current: password, label: "模拟 iCloud 密钥" }, owner); return { options: await r.json(), binding: `${owner}; ${cookie(r, "wb_webauthn")}` }; }
async function authentication() { const r = await req("passkeys/login/options", { trusted: true, label: "密钥登录电脑" }); return { options: await r.json(), binding: cookie(r, "wb_webauthn") }; }
try {
  await start();
  const legacy = JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8"));
  legacy.version = 1; delete legacy.username; delete legacy.userId; legacy.sessions = [];
  await writeFile(path.join(directory, "auth.json"), JSON.stringify(legacy));
  assert.equal((await (await req("status")).json()).needsUsername, true);
  owner = cookie(await req("login", { username, password }));
  assert.equal((await (await req("account", undefined, owner)).json()).username, username);
  assert.equal(JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8")).hash, legacy.hash);
  console.log("PASS legacy password migration preserves password hash and adds owner username");
  assert.equal((await (await req("passkeys/status")).json()).available, true);
  assert.equal((await (await req("passkeys/status", undefined, "", 200, "127.0.0.1:3944")).json()).available, false);
  await req("passkeys/register/options", { current: password }, "", 401);
  await req("passkeys/register/options", { current: "wrong" }, owner, 401);
  await req("passkeys/login/options", {}, "", 409);
  await req("passkeys/register/options", { current: password }, owner, 400, "127.0.0.1:3944");
  const fake = authenticator();
  for (const bad of [{ uv: false }, { wrongOrigin: true }, { wrongRP: true }, { wrongChallenge: true }]) {
    const c = await registration(); userId = c.options.user.id;
    assert.equal(c.options.authenticatorSelection.residentKey, "required");
    assert.equal(c.options.authenticatorSelection.userVerification, "required");
    await req("passkeys/register/verify", { credential: fake.cred(c.options, { registration: true, ...bad }) }, c.binding, 400);
    assert.equal((await (await req("passkeys", undefined, owner)).json()).passkeys.length, 0);
  }
  const c = await registration(); userId = c.options.user.id;
  const registerCredential = fake.cred(c.options, { registration: true });
  await req("passkeys/register/verify", { credential: registerCredential }, owner, 410);
  await req("passkeys/register/verify", { credential: registerCredential }, c.binding);
  await req("passkeys/register/verify", { credential: registerCredential }, c.binding, 410);
  const listed = await (await req("passkeys", undefined, owner)).json(); assert.equal(listed.passkeys.length, 1); assert.ok(!JSON.stringify(listed).includes("publicKey"));
  assert.ok(!(await readFile(path.join(directory, "auth.json"), "utf8")).includes(fake.privateKey.export({ type: "pkcs8", format: "pem" })));
  console.log("PASS WebAuthn registration, UV requirement, origin/RP/challenge validation, session binding, public-key-only storage");
  let authenticated;
  for (const bad of [{ uv: false }, { wrongOrigin: true }, { wrongRP: true }, { wrongChallenge: true }, { badSignature: true }, { wrongUser: true }]) {
    const a = await authentication();
    assert.equal(a.options.userVerification, "required");
    await req("passkeys/login/verify", { credential: fake.cred(a.options, bad) }, a.binding, 401);
  }
  let a = await authentication();
  const assertion = fake.cred(a.options);
  await req("passkeys/login/verify", { credential: assertion }, "", 410);
  authenticated = cookie(await req("passkeys/login/verify", { credential: assertion }, a.binding));
  assert.ok(authenticated);
  await req("account", undefined, authenticated);
  await req("passkeys/login/verify", { credential: assertion }, a.binding, 410);
  a = await authentication(); await req("passkeys/login/verify", { credential: fake.cred(a.options, { counter: 1 }) }, a.binding, 401);
  await stop(); await start();
  a = await authentication(); authenticated = cookie(await req("passkeys/login/verify", { credential: fake.cred(a.options, { counter: 2 }) }, a.binding));
  console.log("PASS signed passwordless authentication, signature/user validation, replay/counter protection and restart persistence");
  a = await authentication();
  owner = cookie(await req("password", { current: password, next: replacement }, owner));
  await req("passkeys/login/verify", { credential: fake.cred(a.options, { counter: 3 }) }, a.binding, 410);
  assert.equal(JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8")).userId, userId);
  a = await authentication(); authenticated = cookie(await req("passkeys/login/verify", { credential: fake.cred(a.options, { counter: 3 }) }, a.binding));
  console.log("PASS password rotation preserves bound keys and stable user handle while invalidating pending challenges");
  await req("passkeys/remove", { id: fake.id, current: "wrong" }, owner, 401);
  await req("passkeys/remove", { id: fake.id, current: replacement }, owner);
  await req("account", undefined, authenticated, 401);
  await req("passkeys/login/options", {}, "", 409);
  await req("account", undefined, owner);
  console.log("PASS removing passkey requires password, revokes its sessions and preserves password login");
} finally { await stop(); }
