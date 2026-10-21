import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require(require.resolve("@next/env", { paths: [require.resolve("next/package.json")] }));
loadEnvConfig(process.cwd());
const authPath = resolve(process.env.WORKBENCH_DATA_DIR || "data", "auth.json");
if (!existsSync(authPath) || !JSON.parse(readFileSync(authPath, "utf8")).username) {
  console.error("请先用普通本机模式打开 http://127.0.0.1:3939，创建主账号，再启动手机扫码模式。");
  process.exit(1);
}
console.log("请先关闭正在运行的本机工作台服务。局域网模式仍然需要账号登录。");
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  if (/virtual|vmware|vbox|host.only|本地连接\*/i.test(name)) continue;
  for (const a of addresses || []) if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) console.log(`手机与电脑在同一网络后，访问 http://${a.address}:3939`);
}
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3939", "-H", "0.0.0.0"], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, WORKBENCH_LAN: "true" },
});
child.on("exit", code => process.exit(code || 0));
process.on("SIGINT", () => child.kill("SIGINT"));
