export async function accountApi(path: string, body?: unknown) {
  const r = await fetch(`/api/auth/${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "暂时无法连接，请重试");
  return data;
}
export function passkeyError(error: unknown) {
  const e = error as Error;
  if (e.name === "NotAllowedError" || e.name === "AbortError") return "验证已取消或超时，可以重新尝试。";
  if (e.name === "InvalidStateError") return "这台验证设备已保存此通行密钥，可以直接用它登录。";
  if (e.name === "SecurityError") return "当前地址不支持通行密钥；本机请用 localhost，云端请使用固定 HTTPS 域名。";
  return e.message || "通行密钥暂时无法使用，请重试或使用账号密码。";
}
