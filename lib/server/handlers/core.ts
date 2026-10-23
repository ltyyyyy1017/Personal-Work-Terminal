import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  AUTH_PATH,
  SECRETS_PATH,
  appendLog,
  dirs,
  mutateStore,
  newId,
  nowISO,
  readStore,
  storageInfo,
} from "../../store";
import { errorResponse, json, str } from "../http";
import { AppError, assert } from "../../errors";
import { authRequired, generateToken } from "../../auth";
import { getGithubToken } from "../../github";
import {departmentProfiles} from "../../organizations";
import type { Settings, Store } from "../../types";
import type { Ctx } from "../ctx";
import type { NextResponse } from "next/server";

export function publicTokens(store: Store) {
  return store.tokens.map(({ hash, ...rest }) => rest);
}

export function bootstrap() {
  const store = readStore();
  const gh = store.github;
  return json({
    settings: store.settings,
    system: {
      authRequired: authRequired(),
      dataDir: storageInfo().dataDir,
      platform: process.platform,
      version: "1.0.0",
      tokenCount: store.tokens.length,
    },
    github: gh
      ? {
          connected: Boolean(getGithubToken()),
          login: gh.login,
          name: gh.name,
          avatarUrl: gh.avatarUrl,
          fetchedAt: gh.fetchedAt,
          repoCount: gh.repos.length,
          commits7d: gh.commits7d,
          openIssues: gh.openIssues,
        }
      : { connected: Boolean(getGithubToken()) },
    counts: {
      events: store.events.length,
      tasks: store.tasks.filter((t) => !t.sourceMissing&&t.status !== "done").length,
      activities: store.activities.length,
      projects: store.projects.length,
      docs: store.docs.length,
      tokens: store.tokens.length,
    },
    tokens: publicTokens(store),
    log: store.log.slice(0, 12),
  });
}

function pickString(value: unknown, fallback: string, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function mergeSettings(current: Settings, body: Record<string, unknown>): Settings {
  const next: Settings = structuredClone(current);
  if(body.billingProfiles&&typeof body.billingProfiles==="object"){
    next.billingProfiles??={};
    for(const org of [...new Set(["示例组织一","示例组织二","个人",...(current.departmentProfiles||[]).map(p=>p.organization)])]){const p=(body.billingProfiles as Record<string,unknown>)[org];if(p&&typeof p==="object"){const v=p as Record<string,unknown>;next.billingProfiles[org]={invoiceTitle:pickString(v.invoiceTitle,"",160),taxId:pickString(v.taxId,"",60)};}}
  }
  next.name = pickString(body.name, next.name, 60);
  next.org = pickString(body.org, next.org, 80);
  next.school = pickString(body.school, next.school, 120);

  if (body.reimbursement && typeof body.reimbursement === "object") {
    const r = body.reimbursement as Record<string, unknown>;
    const target = next.reimbursement;
    target.department = pickString(r.department, target.department, 40);
    target.submitter = pickString(r.submitter, target.submitter, 40);
    target.phone = pickString(r.phone, target.phone, 40);
    target.bankName = pickString(r.bankName, target.bankName, 80);
    target.bankAccount = pickString(r.bankAccount, target.bankAccount, 60);
    target.invoiceTitle = pickString(r.invoiceTitle, target.invoiceTitle, 120);
    target.taxId = pickString(r.taxId, target.taxId, 40);
    target.namingTemplate = pickString(r.namingTemplate, target.namingTemplate, 120);
    target.project = pickString(r.project, target.project, 80);
    if (typeof r.mergeAll === "boolean") target.mergeAll = r.mergeAll;
    if (typeof r.autoClassify === "boolean") target.autoClassify = r.autoClassify;
    if (r.exportFormats!==undefined) {
      assert(r.exportFormats&&typeof r.exportFormats==="object"&&!Array.isArray(r.exportFormats),"匯出格式設定不正確");
      const entries=Object.entries(r.exportFormats);assert(entries.length<=50,"部門匯出格式最多 50 組");
      target.exportFormats??={};
      for(const [department,raw]of entries){
        assert(departmentProfiles(next).some(p=>p.id===department),"匯出格式須屬於已設定的部門");
        assert(raw&&typeof raw==="object"&&!Array.isArray(raw),"匯出格式設定不正確");
        const v=raw as Record<string,unknown>;assert(v.format==="standard"||v.format==="income-expense","請選擇有效的匯出格式");
        target.exportFormats[department]={format:v.format,title:pickString(v.title,"",160).trim()};
      }
    }
  }

  if (body.calendar && typeof body.calendar === "object") {
    const c = body.calendar as Record<string, unknown>;
    const target = next.calendar;
    for(const key of ["myMemberIds","myNames"] as const)if(c[key]!==undefined){assert(Array.isArray(c[key])&&c[key].length<=(key==="myMemberIds"?100:20)&&c[key].every(v=>typeof v==="string"&&v.trim().length>0&&v.length<=100),"請選擇有效的本人身份或姓名別名");target[key]=[...new Set((c[key] as string[]).map(v=>v.trim()))];}
    if (c.weekStart === 0 || c.weekStart === 1) target.weekStart = c.weekStart as 0 | 1;
    if (c.defaultView === "month" || c.defaultView === "agenda") {
      target.defaultView = c.defaultView;
    }
    if (Number.isFinite(Number(c.reminderMinutes))) target.reminderMinutes = Number(c.reminderMinutes);
  }

  if (body.appearance && typeof body.appearance === "object") {
    const a = body.appearance as Record<string, unknown>;
    if (typeof a.compact === "boolean") next.appearance.compact = a.compact;
  }

  next.updatedAt = nowISO();
  return next;
}

export async function patchSettings(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const calendar=body.calendar as Record<string,unknown>|undefined;
    if(calendar&&Array.isArray(calendar.myMemberIds))assert(calendar.myMemberIds.every(id=>s.members.some(m=>m.id===id)),"本人身份須選擇現有成員");
    s.settings = mergeSettings(s.settings, body);
    return s.settings;
  });
  return json({ settings: result });
}

/* ---------------------------------- auth ---------------------------------- */

/* -------------------------------- 系统信息 -------------------------------- */

export function storage() {
  const store = readStore();
  const info = storageInfo();
  const sizeOf = (dir: string) => {
    let total = 0;
    const walk = (p: string) => {
      try {
        for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
          const full = path.join(p, entry.name);
          if (entry.isDirectory()) walk(full);
          else total += fs.statSync(full).size;
        }
      } catch {
        /* 忽略 */
      }
    };
    walk(dir);
    return total;
  };
  return json({
    ...info,
    dirs: {
      files: dirs.files,
      docs: dirs.docs,
      exports: dirs.exports,
      shared: dirs.shared,
    },
    sizes: {
      docs: sizeOf(dirs.docs),
      exports: sizeOf(dirs.exports),
      files: sizeOf(dirs.files),
    },
    counts: { docs: store.docs.length, tokens: store.tokens.length },
    cloudHints: [
      {
        os: "Windows",
        path: "%USERPROFILE%\\OneDrive\\工作台数据",
        note: "把 WORKBENCH_DATA_DIR 指向 OneDrive 里的文件夹，两台设备各自运行工作台即可自动同步。",
      },
      {
        os: "macOS",
        path: "~/Library/Mobile Documents/com~apple~CloudDocs/工作台数据",
        note: "或使用坚果云 / Dropbox，只要两端指向同一个同步文件夹。",
      },
    ],
  });
}

export async function backup() {
  const zip = new JSZip();
  const store = readStore();
  zip.file("store.json", JSON.stringify(store, null, 2));
  for (const source of [{dir:dirs.docs,prefix:"docs"},{dir:dirs.reimburse,prefix:"files/reimburse"},{dir:dirs.avatars,prefix:"files/avatars"},{dir:dirs.exports,prefix:"exports"}]) {
    if (!fs.existsSync(source.dir)) continue;
    for (const entry of fs.readdirSync(source.dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath ?? source.dir, entry.name);
      zip.file(`${source.prefix}/${path.relative(source.dir, full).split(path.sep).join("/")}`, fs.readFileSync(full));
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const name = `工作台备份_${new Date().toISOString().slice(0, 10)}.zip`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/zip",
      "cache-control": "private, no-store, no-cache, must-revalidate",
      "pragma": "no-cache",
      "content-disposition": `attachment; filename="workbench-backup.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

export async function seed() {
  const now = nowISO();
  const { result } = await mutateStore((s) => {
    const created = { events: 0, tasks: 0, projects: 0 };
    if (s.events.length === 0) {
      const today = new Date();
      const day = (offset: number, hour: number) => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, hour, 0);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
      };
      const samples = [
        { title: "行政部周会 · 物资与报销对账", start: day(0, 20), end: day(0, 21), tags: ["行政部", "会议"], location: "线上 / 腾讯会议", description: "核对本周采购与报销单据" },
        { title: "运营部推文排期确认", start: day(1, 15), end: day(1, 16), tags: ["运营部", "活动"], location: "行政楼 302" },
        { title: "示例组织一迎新物料下单", start: day(2, 10), end: day(2, 11), tags: ["行政部"], location: "淘宝 / 供应商对接" },
      ];
      for (const item of samples) {
        s.events.push({
          id: newId("evt"),
          title: item.title,
          start: item.start,
          end: item.end,
          allDay: false,
          location: item.location,
          description: item.description,
          tags: item.tags,
          source: "import",
          done: false,
          createdAt: now,
          updatedAt: now,
        });
        created.events++;
      }
    }
    if (s.tasks.length === 0) {
      const tasks = [
        { title: "整理 5 月活动报销单据", department: "行政部" as const, priority: "high" as const },
        { title: "公众号「迎新特辑」初稿", department: "运营部" as const, priority: "normal" as const },
        { title: "更新社团物资台账", department: "行政部" as const, priority: "low" as const },
        { title: "拍摄迎新海报素材", department: "运营部" as const, priority: "normal" as const },
      ];
      for (const t of tasks) {
        s.tasks.push({
          id: newId("task"),
          title: t.title,
          department: t.department,
          status: "doing",
          priority: t.priority,
          createdAt: now,
          updatedAt: now,
        });
        created.tasks++;
      }
    }
    if (s.projects.length === 0) {
      const projects = [
        { name: "示例组织一迎新物料", department: "行政部" as const, note: "明信片 + 徽章礼盒采购" },
        { name: "学校运营部官网改版", department: "运营部" as const, note: "信息架构与视觉统一" },
        { name: "个人工作台", department: "个人" as const, note: "报销自动化 + 日程 API" },
      ];
      for (const p of projects) {
        s.projects.push({
          id: newId("prj"),
          name: p.name,
          department: p.department,
          status: "active",
          note: p.note,
          tags: [],
          createdAt: now,
          updatedAt: now,
        });
        created.projects++;
      }
    }
    appendLog(s, "system", "载入示例数据");
    return created;
  });
  return json({ ok: true, created: result });
}

/* --------------------------------- tokens --------------------------------- */

export async function listTokens() {
  const store = readStore();
  return json({ tokens: publicTokens(store) });
}

export async function createToken(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const label = str(body.label).trim() || "外部日历 API";
  const { token, hash, prefix } = generateToken();
  const record = {
    id: newId("tok"),
    label,
    hash,
    prefix,
    createdAt: nowISO(),
  };
  await mutateStore((s) => {
    s.tokens.push(record);
    appendLog(s, "token", `创建 API Token「${label}」`);
  });
  return json({
    token,
    record: { id: record.id, label, prefix, createdAt: record.createdAt },
    note: "Token 只显示这一次，请立即复制保存。",
  });
}

export async function deleteToken(ctx: Ctx) {
  await mutateStore((s) => {
    const idx = s.tokens.findIndex((t) => t.id === ctx.params.id);
    if (idx < 0) throw new AppError("Token 不存在", 404);
    s.tokens.splice(idx, 1);
  });
  return json({ ok: true });
}

/* --------------------------------- 调试信息 -------------------------------- */

export function authFiles() {
  return json({
    authFile: fs.existsSync(AUTH_PATH),
    secretsFile: fs.existsSync(SECRETS_PATH),
  });
}

export { errorResponse };
