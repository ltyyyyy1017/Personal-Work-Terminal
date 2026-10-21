import { appendLog, mutateStore, newId, nowISO, readStore } from "../../store";
import { json, str } from "../http";
import { AppError, assert } from "../../errors";
import { DEPARTMENTS } from "../../constants";
import { clearGithubToken, fetchSnapshot, getGithubToken, repoDetail, saveGithubToken } from "../../github";
import type { Ctx } from "../ctx";
import type { Project } from "../../types";

export async function listProjects() {
  const store = readStore();
  const repos = new Map((store.github?.repos ?? []).map((r) => [r.fullName, r]));
  const projects = [...store.projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => ({ ...p, repoInfo: p.repo ? repos.get(p.repo) ?? null : null }));
  return json({ projects, connected: Boolean(getGithubToken()) });
}

export async function createProject(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const name = str(body.name).trim();
  assert(name, "请填写项目名称");
  const now = nowISO();
  const project: Project = {
    id: newId("prj"),
    name,
    department: (DEPARTMENTS as readonly string[]).includes(String(body.department))
      ? (body.department as Project["department"])
      : "个人",
    status: (["idea", "active", "paused", "done"] as const).includes(body.status as never)
      ? (body.status as Project["status"])
      : "active",
    repo: str(body.repo).trim() || undefined,
    link: str(body.link).trim() || undefined,
    note: str(body.note, "", 500) || undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 6) : [],
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((s) => {
    s.projects.push(project);
    appendLog(s, "project", `新建项目「${name}」`);
  });
  return json({ project });
}

export async function patchProject(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const { result } = await mutateStore((s) => {
    const p = s.projects.find((x) => x.id === ctx.params.id);
    if (!p) throw new AppError("项目不存在", 404);
    if (typeof body.name === "string" && body.name.trim()) p.name = str(body.name).trim();
    if ((DEPARTMENTS as readonly string[]).includes(String(body.department))) {
      p.department = body.department as Project["department"];
    }
    if (["idea", "active", "paused", "done"].includes(String(body.status))) {
      p.status = body.status as Project["status"];
    }
    if ("repo" in body) p.repo = str(body.repo).trim() || undefined;
    if ("link" in body) p.link = str(body.link).trim() || undefined;
    if ("note" in body) p.note = str(body.note, "", 500) || undefined;
    if (Array.isArray(body.tags)) p.tags = body.tags.map(String).slice(0, 6);
    p.updatedAt = nowISO();
    return p;
  });
  return json({ project: result });
}

export async function deleteProject(ctx: Ctx) {
  await mutateStore((s) => {
    const idx = s.projects.findIndex((p) => p.id === ctx.params.id);
    if (idx < 0) throw new AppError("项目不存在", 404);
    s.projects.splice(idx, 1);
  });
  return json({ ok: true });
}

export async function linkRepo(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const fullName = str(body.fullName).trim();
  assert(fullName.includes("/"), "仓库名格式应为 owner/name");
  const { result } = await mutateStore((s) => {
    let project = s.projects.find((p) => p.id === String(body.projectId ?? ""));
    if (!project) {
      const now = nowISO();
      project = {
        id: newId("prj"),
        name: fullName.split("/")[1],
        department: "个人",
        status: "active",
        repo: fullName,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      s.projects.push(project);
    } else {
      project.repo = fullName;
      project.updatedAt = nowISO();
    }
    const repo = s.github?.repos.find((r) => r.fullName === fullName);
    if (repo) {
      project.lastCommitAt = repo.pushedAt;
      project.openIssues = repo.openIssues;
    }
    appendLog(s, "project", `关联仓库 ${fullName}`);
    return project;
  });
  return json({ project: result });
}

/* --------------------------------- github --------------------------------- */

export function githubStatus() {
  const store = readStore();
  return json({
    connected: Boolean(getGithubToken()),
    publicConnected: Boolean(store.github),
    login: store.github?.login ?? null,
    snapshot: store.github ?? null,
    syncedAt: store.github?.fetchedAt ?? null,
  });
}

export async function saveToken(ctx: Ctx) {
  const body = (await ctx.body()) as Record<string, unknown>;
  const token = str(body.token, "", 200).trim();
  assert(token, "请填写 GitHub Token");
  const profile = await saveGithubToken(token);
  await mutateStore((s) => {
    appendLog(s, "github", `连接 GitHub 账号 ${profile.login}`);
  });
  return json({ ok: true, profile });
}

export async function removeToken() {
  clearGithubToken();
  await mutateStore((s) => {
    s.github = null;
    appendLog(s, "github", "断开 GitHub 连接");
  });
  return json({ ok: true });
}

export async function syncGithub(ctx:Ctx) {
  const body=await ctx.body<Record<string,unknown>>();const login=str(body.login,"",39).trim();
  assert(!login||/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(login),"GitHub 用户名格式不正确");
  const snapshot = await fetchSnapshot(login||(!getGithubToken()?readStore().github?.login:undefined));
  const { result } = await mutateStore((s) => {
    s.github = snapshot;
    s.meta.lastSyncAt = new Date().toISOString();
    for (const p of s.projects) {
      if (!p.repo) continue;
      const repo = snapshot.repos.find((r) => r.fullName === p.repo);
      if (repo) {
        p.lastCommitAt = repo.pushedAt;
        p.openIssues = repo.openIssues;
      }
    }
    appendLog(
      s,
      "github",
      `同步 GitHub：${snapshot.repos.length} 个仓库，近 7 天 ${snapshot.commits7d} 个提交`,
    );
    return snapshot;
  });
  return json({ snapshot: result });
}

export function listRepos(ctx: Ctx) {
  const store = readStore();
  const q = (ctx.url.searchParams.get("q") ?? "").toLowerCase();
  const repos = (store.github?.repos ?? []).filter((r) =>
    q ? `${r.fullName} ${r.description ?? ""} ${r.language ?? ""}`.toLowerCase().includes(q) : true,
  );
  return json({ repos, connected: Boolean(getGithubToken()) });
}

export async function repoInfo(ctx: Ctx) {
  const full = ctx.url.searchParams.get("full");
  assert(full && full.includes("/"), "缺少仓库参数");
  const detail = await repoDetail(full!);
  return json(detail);
}
