"use client";
import { useEffect, useState } from "react";
import { Fingerprint, Plus, KeyRound, LoaderCircle, Check } from "lucide-react";
import { accountApi, passkeyError } from "@/lib/account-client";
interface Key { id: string; label: string; rpId: string; createdAt: string; lastUsedAt?: string }
interface Support { available: boolean; localUrl?: string }
export default function PasskeySettings() {
  const [keys, setKeys] = useState<Key[]>([]), [support, setSupport] = useState<Support | null>(null), [browserOK, setBrowserOK] = useState(false);
  const [editing, setEditing] = useState(false), [removeId, setRemoveId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const reload = async () => { const [data, available] = await Promise.all([accountApi("passkeys"), accountApi("passkeys/status")]); setKeys(data.passkeys); setSupport(available); };
  useEffect(() => { setBrowserOK(window.isSecureContext && typeof PublicKeyCredential !== "undefined"); void reload().catch(e => setError(e.message)); }, []);
  return <section className="account-section passkey-settings" aria-label="通行密钥"><h3><Fingerprint size={19}/>通行密钥</h3><p className="settings-description">用 iCloud 钥匙串里的密钥，通过 Face ID / Touch ID 登录。电脑的系统窗口中也可选择 iPhone 或 iPad。</p>
    {support && !support.available && <p className="passkey-address-hint">{support.localUrl ? <>本机请<a href={`${support.localUrl}?view=settings`}>改用 localhost 打开</a>，登录后在这里绑定。通行密钥按域名保存。</> : "当前地址不支持通行密钥。即使已启用 HTTPS，纯 IP 也不能绑定；云端请使用 HTTPS 域名。"}</p>}
    {support?.available && !browserOK && <p className="passkey-address-hint">当前浏览器未提供通行密钥功能，请用 Chrome、Edge 或 Safari 打开同一地址。</p>}
    {keys.map(k => <div className="passkey-row" key={k.id}><KeyRound size={18}/><div><strong>{k.label}</strong><small>{k.rpId} · {k.lastUsedAt ? `最近使用 ${new Date(k.lastUsedAt).toLocaleDateString("zh-CN")}` : "已绑定，尚未使用"}</small></div><button className="text-button" disabled={busy} onClick={() => { setRemoveId(k.id); setEditing(false); setError(""); setMessage(""); }}>移除</button></div>)}
    {!editing && !removeId && <button className="button secondary passkey-add" disabled={busy || !support?.available || !browserOK} onClick={() => { setEditing(true); setError(""); setMessage(""); }}><Plus size={15}/>绑定 iCloud / 通行密钥</button>}
    {(editing || removeId) && <form className="passkey-form" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget, body = Object.fromEntries(new FormData(form)); setBusy(true); setError(""); setMessage("");
      try {
        if (removeId) { await accountApi("passkeys/remove", { id: removeId, current: body.current }); setMessage("通行密钥已移除，使用它登录的设备也已退出"); window.dispatchEvent(new Event("workbench:authrequired")); }
        else { const optionsJSON = await accountApi("passkeys/register/options", body); const { startRegistration } = await import("@simplewebauthn/browser"); const credential = await startRegistration({ optionsJSON }); await accountApi("passkeys/register/verify", { credential }); setMessage("通行密钥已绑定，下次可以直接验证登录"); }
        form.reset(); setEditing(false); setRemoveId(""); await reload();
      } catch (e) { setError(passkeyError(e)); } finally { setBusy(false); }
    }}>
      <p className="settings-description">{removeId ? "移除后不能再用此密钥登录，账号密码仍可使用。" : "验证当前密码后，按系统提示选择 iPhone、iCloud 钥匙串或其他密码管理器保存。"}</p>
      {!removeId && <label className="field"><span>密钥名称</span><input name="label" defaultValue="我的 iCloud 通行密钥" maxLength={80} required/></label>}
      <label className="field"><span>验证当前密码</span><input name="current" type="password" autoComplete="current-password" maxLength={200} required/></label>
      <div className="passkey-form-actions"><button className="button primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="account-spinner"/> : <Fingerprint size={15}/>} {removeId ? "确认移除" : "继续，打开系统验证"}</button><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(false); setRemoveId(""); setError(""); }}>取消</button></div>
    </form>}
    {error && <p role="alert" className="account-error">{error}</p>}{message && <p role="status" className="account-saved"><Check size={15}/>{message}</p>}
  </section>;
}
