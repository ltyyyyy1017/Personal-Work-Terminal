"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Fingerprint, LayoutGrid, LoaderCircle, LockKeyhole, Monitor, QrCode, RefreshCw, ShieldCheck, Smartphone, LogOut, ChevronDown } from "lucide-react";
import { accountApi, passkeyError } from "@/lib/account-client";
import PasskeySettings from "./passkey-settings";

type Status = { initialized: boolean; authed: boolean; needsUsername: boolean; username?: string };
type Scan = { id: string; scan: string };
type Pair = { label: string; source:string;createdAt:string; expiresAt: number };
type QR = { id: string; code: string; image: string; expiresAt: number; url: string };
function deviceLabel() {
  return /iPhone/.test(navigator.userAgent) ? "我的 iPhone" : /iPad/.test(navigator.userAgent) ? "我的 iPad" : /Macintosh/.test(navigator.userAgent) ? "我的 Mac" : "我的电脑";
}
function Shell({ children, caption }: { children: ReactNode; caption: string }) {
  return <main className="account-page"><div className="account-orb orb-one"/><div className="account-orb orb-two"/>
    <div className="account-brand"><span><LayoutGrid size={21}/></span>个人工作台</div>
    <section className="account-card">{children}</section>
    <p className="account-footnote"><LockKeyhole size={13}/>{caption}</p>
  </main>;
}
export default function AccountGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState("");
  const [pairCode,setPairCode]=useState(""),[pairConfirmed,setPairConfirmed]=useState(false),[pairTrusted,setPairTrusted]=useState(false);
  const [scan, setScan] = useState<Scan | null>(null), [pair, setPair] = useState<Pair | null>(null), [approved, setApproved] = useState(false), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { try { setStatus(await accountApi("status")); setError(""); } catch (e) { setStatus(null); setError((e as Error).message); } }, []);
  useEffect(() => {
    const raw = location.hash.slice(1).split(".");
    if (new URLSearchParams(location.search).get("login") === "qr" && raw.length === 2 && raw.every(v => /^[\w-]+$/.test(v))) {
      setScan({ id: raw[0], scan: raw[1] });
      history.replaceState(null, "", location.pathname + location.search);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    const update = () => void refresh();
    window.addEventListener("focus", update); window.addEventListener("workbench:authrequired", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("workbench:authrequired", update); };
  }, [refresh]);
  useEffect(() => {
    if (!scan) return;
    void accountApi("qr/inspect", scan).then(setPair).catch(e => setError(e.message));
  }, [scan]);
  if (!status) return <Shell caption="你的事务，安心留在自己的空间。"><div className="account-symbol"><ShieldCheck size={30}/></div><h1>{error ? "暂时无法连接" : "正在打开工作台"}</h1>{error ? <><p role="alert" className="account-error">{error}</p><button className="button primary" onClick={() => void refresh()}>重试</button></> : <LoaderCircle className="account-spinner"/>}</Shell>;
  if (scan && status.authed) return <Shell caption="仅确认你刚刚在电脑上发起的登录。"><div className="account-symbol"><Monitor size={30}/></div>
    <h1>{approved ? "电脑已获准登录" : "确认电脑登录"}</h1>
    {approved ? <><p>可以回到电脑继续使用工作台。</p><div className="account-success"><Check size={22}/>确认完成</div><button className="button secondary" onClick={() => { setScan(null); history.replaceState(null, "", "/"); }}>在手机打开工作台</button></> : <>
      <p>只有正在操作电脑时才批准。请手工输入电脑屏幕上的六位配对码，不要批准他人发来的链接。</p>{pair && <p className="pair-device">来源：{pair.source==="direct"?"本机连接":pair.source} · {new Date(pair.createdAt).toLocaleString("zh-CN")}<br/>设备自报名：{pair.label}（由请求方填写）</p>}
      <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await accountApi("qr/approve",{...scan,code:pairCode,confirmed:pairConfirmed,trusted:pairTrusted});setApproved(true);setError("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      <label className="field"><span>电脑屏幕上的配对码</span><input inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required value={pairCode} onChange={e=>setPairCode(e.target.value.replace(/\D/g,""))}/></label>
      <label className="record-confirm"><input type="checkbox" required checked={pairConfirmed} onChange={e=>setPairConfirmed(e.target.checked)}/>我正在使用这台电脑，并且是我刚刚发起的登录</label>
      <label className="record-confirm"><input type="checkbox" checked={pairTrusted} onChange={e=>setPairTrusted(e.target.checked)}/>信任这台电脑 90 天（默认仅登录 12 小时）</label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <button className="button primary account-main-button" disabled={busy||!pair||!pairConfirmed||pairCode.length!==6}>{busy?"正在验证…":"核对并批准电脑登录"}</button></form>
      <button className="button secondary account-main-button" onClick={() => { setScan(null); history.replaceState(null, "", "/"); }}>取消，进入手机工作台</button>
    </>}
  </Shell>;
  if (status.authed) return <>{children}</>;
  return <AccountAccess status={status} phone={Boolean(scan)} onSuccess={refresh}/>;
}

export function AccountAccess({ status, phone = false, onSuccess }: { status: Status; phone?: boolean; onSuccess: () => void }) {
  const [passkey, setPasskey] = useState<{ available: boolean; localUrl?: string; count: number } | null>(null), [passkeyOK, setPasskeyOK] = useState(false);
  const [mode, setMode] = useState<"password" | "qr">("password"), [trusted, setTrusted] = useState(false), [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [qr, setQR] = useState<QR | null>(null), [now, setNow] = useState(Date.now());
  const setup = !status.initialized;
  useEffect(() => setLabel(deviceLabel()), []);
  useEffect(() => { setPasskeyOK(window.isSecureContext && typeof PublicKeyCredential !== "undefined"); void accountApi("passkeys/status").then(setPasskey).catch(() => {}); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!qr || mode !== "qr" || qr.expiresAt <= now) return;
    const timer = setInterval(() => {
      void accountApi("qr/status", { id: qr.id }).then(data => { if (data.ok) onSuccess(); }).catch(e => { setError(e.message); setQR(null); });
    }, 2000);
    return () => clearInterval(timer);
  // The separate clock updates the expiry display without restarting polling each second.
  }, [qr, mode, onSuccess, now >= (qr?.expiresAt || Infinity)]);
  const newQR = async () => {
    setBusy(true); setError(""); setQR(null);
    try { setQR(await accountApi("qr/new", { trusted, label })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Shell caption="单一主账号 · 事务和文件保留在原来的位置">
    <div className="account-symbol">{setup ? <ShieldCheck size={30}/> : phone ? <Smartphone size={30}/> : <Fingerprint size={30}/>}</div>
    <span className="account-eyebrow">YOUR OWN SPACE</span>
    <h1>{setup ? "创建你的主账号" : phone ? "先在手机登录" : "欢迎回到工作台"}</h1>
    <p>{setup ? "设置一次，安心管理两个部门的日常。" : phone ? "登录后核对配对码，再确认电脑登录。" : "用通行密钥确认身份，从容开始今天。"}</p>
    {!setup && !status.needsUsername && <div className="passkey-login"><button className="button passkey-login-button" disabled={busy || !passkey?.available || !passkeyOK} onClick={async () => {
      setBusy(true); setError("");
      try { const optionsJSON = await accountApi("passkeys/login/options", { trusted, label }); const { startAuthentication } = await import("@simplewebauthn/browser"); const credential = await startAuthentication({ optionsJSON }); await accountApi("passkeys/login/verify", { credential }); onSuccess(); }
      catch (e) { setError(passkeyError(e)); } finally { setBusy(false); }
    }}><Fingerprint size={20}/>{busy ? "正在验证…" : "使用 iPhone / 通行密钥登录"}</button>
      {passkey?.localUrl ? <small>本机通行密钥请<a href={`${passkey.localUrl}${phone ? "" : location.search}`}>用 localhost 打开</a>，首次在设置中绑定。</small> : <small>{!passkey?.available ? "通行密钥需要 HTTPS；电脑本机可使用 localhost。" : !passkeyOK ? "请用 Chrome、Edge 或 Safari 打开以使用通行密钥。" : "Face ID · Touch ID · iCloud 钥匙串，首次在设置中绑定"}</small>}
    </div>}
    {!setup && !phone && !status.needsUsername && <div className="account-tabs" role="group" aria-label="登录方式"><button className={mode === "password" ? "active" : ""} onClick={() => { setMode("password"); setError(""); }}>账号登录</button><button className={mode === "qr" ? "active" : ""} onClick={() => { setMode("qr"); setError(""); }}><QrCode size={15}/>手机扫码</button></div>}
    {mode === "password" ? <form onSubmit={async e => {
      e.preventDefault(); setError(""); const form = new FormData(e.currentTarget);
      if (setup && form.get("password") !== form.get("confirm")) { setError("两次输入的密码不一致"); return; }
      setBusy(true);
      try { await accountApi(setup ? "setup" : "login", { username: form.get("username"), password: form.get("password"), trusted, label }); onSuccess(); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>
      {status.needsUsername && <p className="account-hint">使用原访问密码，并为主账号设置一个登录名。</p>}
      <label className="field"><span>{status.needsUsername ? "设置账号名" : "账号"}</span><input name="username" autoComplete="username" required minLength={2} maxLength={40} autoCapitalize="none" spellCheck={false} placeholder="给自己起一个登录名" autoFocus/></label>
      <label className="field"><span>{setup ? "设置密码" : "密码"}</span><input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 10 : undefined} maxLength={200} required placeholder={setup ? "至少 10 个字符" : "输入你的密码"}/></label>
      {setup && <label className="field"><span>确认密码</span><input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={200} required placeholder="再输入一次密码"/></label>}
      <Trust value={trusted} onChange={setTrusted}/>
      {trusted && <label className="field"><span>设备名称</span><input value={label} onChange={e => setLabel(e.target.value)} maxLength={80} required placeholder="例如：宿舍电脑"/></label>}
      {error && <p className="account-error" role="alert">{error}</p>}
      <button className="button primary account-main-button" disabled={busy}>{busy ? <LoaderCircle className="account-spinner" size={18}/> : <>{setup ? "创建并进入工作台" : "登录工作台"}<ArrowRight size={17}/></>}</button>
    </form> : <div className="account-qr-area">
      {qr ? <><div className={`account-qr ${now >= qr.expiresAt ? "expired" : ""}`}><img src={qr.image} alt="使用 iPhone 相机扫描登录二维码" width={244} height={244}/>{now >= qr.expiresAt && <button className="button secondary" onClick={() => void newQR()}><RefreshCw size={16}/>刷新二维码</button>}</div><div className="qr-pair-code">配对码 <strong>{qr.code}</strong><span>{Math.max(0, Math.ceil((qr.expiresAt - now) / 1000))} 秒</span></div><p className="account-hint">iPhone 相机扫码 → 手机登录 → 核对配对码</p><small className="account-network">手机与电脑需在同一网络 · {qr.url}</small><button className="text-button" disabled={busy} onClick={() => void newQR()}>重新生成二维码</button></> : <><div className="qr-placeholder"><QrCode size={74} strokeWidth={1}/></div><Trust value={trusted} onChange={setTrusted}/><label className="field"><span>登录设备</span><input value={label} onChange={e => setLabel(e.target.value)} maxLength={80}/></label><button className="button primary account-main-button" disabled={busy} onClick={() => void newQR()}>{busy ? <LoaderCircle className="account-spinner" size={18}/> : <QrCode size={18}/>}生成登录二维码</button><p className="account-hint">首次使用：创建主账号后，在电脑运行项目里的「启动手机扫码.cmd」，再按提示打开局域网版工作台。</p></>}
      {error && <p className="account-error" role="alert">{error}</p>}
    </div>}
  </Shell>;
}
function Trust({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <label className="account-trust"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}/><span><strong>信任这台设备</strong><small>90 天内自动登录，可在设置中取消</small></span></label>;
}

interface Device { id: string; label: string; trusted: boolean; current: boolean; lastSeenAt: string; expiresAt: string }
export function AccountSettings() {
  const [data, setData] = useState<{ username: string; devices: Device[] } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const reload = useCallback(async () => setData(await accountApi("account")), []);
  useEffect(() => { void reload().catch(e => setError(e.message)); }, [reload]);
  const act = async (fn: () => Promise<unknown>, text: string) => { setBusy(true); setError(""); setMessage(""); try { await fn(); await reload(); setMessage(text); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const logout = async () => { await accountApi("logout", {}); location.reload(); };
  return <section className="panel settings-panel account-settings"><div className="panel-heading"><div><h2>账号与登录设备</h2><p>管理登录方式，让每次访问都安心。</p></div><div className="icon-tile purple"><ShieldCheck size={21}/></div></div>
    <div className="account-settings-body">
    {data && <><div className="account-owner"><span className="account-owner-avatar"><Fingerprint size={26}/></span><div><strong>{data.username}</strong><small><span className="account-owner-dot"/>个人主账号</small></div><button className="button secondary" disabled={busy} onClick={() => void act(logout, "")}><LogOut size={16}/>退出登录</button></div>
    <div className="account-security-grid">
      <PasskeySettings/>
      <section className="account-section account-sessions" aria-label="登录设备"><div className="account-section-heading"><h3><Monitor size={19}/>登录设备</h3><span className="account-section-count">{data.devices.length} 台</span></div><p className="settings-description">信任设备可在 90 天内自动登录。你可以随时取消授权。</p>
        <div className="account-device-list">{data.devices.map(d => <div className="account-device" key={d.id}><div className="account-device-icon">{/iPhone|iPad|手机/.test(d.label) ? <Smartphone size={23}/> : <Monitor size={23}/>}</div><div><strong>{d.label}{d.current && <em>当前设备</em>}</strong><small>{d.trusted ? "受信任设备" : "普通登录 · 12 小时"}</small><small>最近访问 {new Date(d.lastSeenAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div><button className="text-button" disabled={busy} onClick={() => void act(async () => { await accountApi("devices/revoke", { id: d.id }); if (d.current) location.reload(); }, "设备授权已取消")}>{d.current ? "退出" : "取消授权"}</button></div>)}</div>
      </section>
    </div>
    <details className="account-password-section"><summary><span className="account-password-icon"><LockKeyhole size={21}/></span><span><strong>修改账号和密码</strong><small>需要时再展开，修改后其他设备会退出登录。</small></span><ChevronDown size={19}/></summary><div className="account-password-content"><p className="settings-description">已绑定的通行密钥仍可登录，需要时可单独移除。</p>
    <form onSubmit={e => { e.preventDefault(); const form = e.currentTarget, v = Object.fromEntries(new FormData(form)); if (v.next !== v.confirm) { setError("两次输入的新密码不一致"); return; } void act(async () => { await accountApi("password", v); form.reset(); }, "账号已更新，其他设备已退出"); }}>
      <div className="account-password-grid">
      <label className="field"><span>账号名</span><input name="username" defaultValue={data.username} autoComplete="username" minLength={2} maxLength={40} required/></label>
      <label className="field"><span>当前密码</span><input name="current" type="password" autoComplete="current-password" required maxLength={200}/></label>
      <label className="field"><span>新密码</span><input name="next" type="password" autoComplete="new-password" minLength={10} maxLength={200} required placeholder="至少 10 个字符"/></label>
      <label className="field"><span>确认新密码</span><input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={200} required/></label>
      </div><button className="button primary" disabled={busy}>保存账号设置</button>
    </form></div></details></>}
    {error && <p className="account-error" role="alert">{error}</p>}{message && <p className="account-saved" role="status"><Check size={17}/>{message}</p>}
    </div>
  </section>;
}
