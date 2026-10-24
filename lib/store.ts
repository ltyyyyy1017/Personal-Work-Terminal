import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LogEntry, Settings, Store } from "./types";
import {organizationFor,departmentProfiles,DEFAULT_DEPARTMENTS} from "./organizations";
import {migrateLocalWork} from "./local-work";
import {atomicWrite} from "./atomic-file";

// Private data is a runtime mount, not a build dependency to copy into standalone output.
const ROOT = process.getBuiltinModule("path").resolve(process.env.WORKBENCH_DATA_DIR || "data");

export const dirs = {
  root: ROOT,
  files: path.join(ROOT, "files"),
  avatars: path.join(ROOT, "files", "avatars"),
  reimburse: path.join(ROOT, "files", "reimburse"),
  docs: path.join(ROOT, "docs"),
  shared: path.join(ROOT, "docs", "shared"),
  archive: path.join(ROOT, "docs", "archive"),
  exports: path.join(ROOT, "exports"),
  tmp: path.join(ROOT, "tmp"),
};

export const STORE_PATH = path.join(ROOT, "store.json");
const BACKUP_PATH = path.join(ROOT, "store.backup.json");
export const AUTH_PATH = path.join(ROOT, "auth.json");
export const SECRETS_PATH = path.join(ROOT, "secrets.json");

export function ensureDirs() {
  for (const dir of [
    dirs.root,
    dirs.files,
    dirs.avatars,
    dirs.reimburse,
    dirs.docs,
    dirs.shared,
    dirs.archive,
    dirs.exports,
    dirs.tmp,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function newId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export const DEFAULT_SETTINGS: Settings = {
  departmentProfiles: DEFAULT_DEPARTMENTS,
  name: "",
  org: "示例组织一",
  school: "",
  departments: ["行政部", "运营部", "个人"],
  reimbursement: {
    department: "行政部",
    submitter: "",
    phone: "",
    bankName: "",
    bankAccount: "",
    invoiceTitle: "",
    taxId: "",
    namingTemplate: "{seq}【{item}-{amount}元】{kind}",
    mergeAll: true,
    autoClassify: true,
    project: "",
  },
  calendar: {
    weekStart: 1,
    defaultView: "month",
    reminderMinutes: 15,
  },
  appearance: { compact: false },
  updatedAt: nowISO(),
};

export function defaultStore(): Store {
  return {
    version: 1,
    members: [],
    matters: [],
    performance: [],
    workLogs: [],
    localWorkRecords: [],
    resources: [],
    createdAt: nowISO(),
    settings: { ...DEFAULT_SETTINGS },
    events: [],
    tasks: [],
    activities: [],
    projects: [],
    docs: [],
    tokens: [],
    log: [],
    github: null,
    meta: {},
  };
}

type Cache = { mtimeMs: number; store: Store | null; queue: Promise<unknown> };
const globalRef = globalThis as unknown as { __workbenchCache?: Cache };

function cache(): Cache {
  globalRef.__workbenchCache ??= {
    mtimeMs: 0,
    store: null,
    queue: Promise.resolve(),
  };
  return globalRef.__workbenchCache;
}

function normalize(store: Partial<Store>): Store {
  const base = defaultStore();
  const result:Store = {
    ...base,
    ...store,
    settings: {
      ...base.settings,
      ...(store.settings ?? {}),
      reimbursement: {
        ...base.settings.reimbursement,
        ...(store.settings?.reimbursement ?? {}),
      },
      calendar: { ...base.settings.calendar, ...(store.settings?.calendar ?? {}) },
      appearance: { ...base.settings.appearance, ...(store.settings?.appearance ?? {}) },
    },
    events: (store.events ?? []).map(e=>({...e,organization:organizationFor(e.tags.find(t=>departmentProfiles(store.settings).some(p=>p.id===t))||"个人",store.settings)})),
    members: (store.members ?? []).map(m=>({...m,organization:organizationFor(m.department,store.settings)})),
    matters: store.matters ?? [],
    performance: store.performance ?? [],
    workLogs: store.workLogs ?? [],
    resources: store.resources ?? [],
    tasks: (store.tasks ?? []).map(t=>({...t,status:t.status==="review"||t.status==="done"?t.status:"doing",organization:organizationFor(t.department,store.settings)})),
    activities: (store.activities ?? []).map(a=>({...a,organization:organizationFor(a.department,store.settings)})),
    projects: store.projects ?? [],
    docs: store.docs ?? [],
    tokens: store.tokens ?? [],
    log: store.log ?? [],
    meta: store.meta ?? {},
    localWorkRecords: store.localWorkRecords ?? [],
  };
  migrateLocalWork(result);
  return result;
}

export function readStore(force = false): Store {
  ensureDirs();
  const c = cache();
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(STORE_PATH).mtimeMs;
  } catch {
    // 文件不存在：初始化
    const fresh = defaultStore();
    writeStoreFile(fresh);
    c.store = fresh;
    c.mtimeMs = mtimeMs || Date.now();
    return fresh;
  }
  if (!force && c.store && c.mtimeMs === mtimeMs) return c.store;
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = normalize(JSON.parse(raw));
    c.store = parsed;
    c.mtimeMs = mtimeMs;
    return parsed;
  } catch (err) {
    console.error("[store] 读取失败，尝试备份", err);
    try {
      const raw = fs.readFileSync(BACKUP_PATH, "utf8");
      const parsed = normalize(JSON.parse(raw));
      c.store = parsed;
      c.mtimeMs = mtimeMs;
      return parsed;
    } catch {
      throw new Error("数据文件与备份均无法读取，请停止应用并恢复数据目录，避免覆盖原有记录。");
    }
  }
}

function writeStoreFile(store: Store) {
  ensureDirs();
  try {
    if (fs.existsSync(STORE_PATH)) {
      atomicWrite(BACKUP_PATH,fs.readFileSync(STORE_PATH));
    }
  } catch {
    /* 备份失败不影响主写入 */
  }
  atomicWrite(STORE_PATH, JSON.stringify(store,null,2));
  cache().mtimeMs = fs.statSync(STORE_PATH).mtimeMs;
}

/** 序列化所有写操作，避免并发覆盖 */
export function mutateStore<T>(fn: (store: Store) => T): Promise<{ store: Store; result: T }> {
  const c = cache();
  const run = async () => {
    const store = structuredClone(readStore(true));
    const result = fn(store);
    writeStoreFile(store);
    c.store = store;
    return { store, result };
  };
  const next = c.queue.then(run, run);
  c.queue = next.catch(() => undefined);
  return next as Promise<{ store: Store; result: T }>;
}

export function appendLog(store: Store, kind: string, message: string) {
  const entry: LogEntry = { id: newId("log"), at: nowISO(), kind, message };
  store.log.unshift(entry);
  if (store.log.length > 300) store.log.length = 300;
}

export function readSecrets(): { githubToken?: string; githubLogin?: string } {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function writeSecrets(secrets: { githubToken?: string; githubLogin?: string }) {
  ensureDirs();
  const {githubToken:_legacy,...safe}=secrets;
  atomicWrite(SECRETS_PATH,JSON.stringify(safe,null,2));
}

export function storageInfo() {
  return {
    dataDir: "业务数据目录",
    envOverride: Boolean(process.env.WORKBENCH_DATA_DIR),
    platform: process.platform,
  };
}
