import type { GithubActivity, GithubRepo, GithubSnapshot } from "./types";
import { AppError } from "./errors";
import { readSecrets, writeSecrets } from "./store";
import {getCredential,saveCredentials} from "./vault";

const API = "https://api.github.com";

interface GhUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

interface GhRepo {
  full_name: string;
  name: string;
  description: string | null;
  private: boolean;
  archived: boolean;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  default_branch: string;
  html_url: string;
}

interface GhEvent {
  type: string;
  repo: { name: string };
  created_at: string;
  payload: {
    size?: number;
    ref?: string;
    ref_type?: string;
    commits?: { message: string; sha: string }[];
    issue?: { title: string; html_url: string; number: number };
    pull_request?: { title: string; html_url: string; number: number };
    action?: string;
    release?: { name: string; html_url: string };
  };
}

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      ...(token?{Authorization: `Bearer ${token}`} : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "personal-workbench",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 401) throw new AppError("GitHub Token 无效或已过期，请重新填写", 401);
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
      const mins = reset ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : 0;
      throw new AppError(
        `GitHub 接口被限流${remaining === "0" ? "（已用完）" : ""}${mins ? `，约 ${mins} 分钟后恢复` : ""}`,
        429,
      );
    }
    throw new AppError(`GitHub 请求失败：${res.status} ${path}`, res.status);
  }
  return (await res.json()) as T;
}

export function getGithubToken(): string | undefined {
  const legacy=readSecrets();
  if(legacy.githubToken){if(!getCredential("github")?.password)saveCredentials({github:{username:legacy.githubLogin||"",password:legacy.githubToken}});writeSecrets({githubLogin:legacy.githubLogin});}
  return getCredential("github")?.password;
}

export async function saveGithubToken(token: string): Promise<{ login: string; name: string; avatarUrl: string }> {
  const clean = token.trim();
  if (!clean) throw new AppError("Token 不能为空", 400);
  const user = await gh<GhUser>("/user", clean);
  const secrets = readSecrets();
  saveCredentials({github:{username:user.login,password:clean}});
  writeSecrets({githubLogin:user.login});
  return {
    login: user.login,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url,
  };
}

export function clearGithubToken() {
  saveCredentials({github:{username:"",password:""}});
  const secrets = readSecrets();
  writeSecrets({ githubLogin: secrets.githubLogin });
}

function mapActivity(events: GhEvent[]): GithubActivity[] {
  const list: GithubActivity[] = [];
  for (const e of events) {
    const at = e.created_at;
    const repo = e.repo.name;
    switch (e.type) {
      case "PushEvent": {
        const commits = e.payload.commits ?? [];
        const head = commits[commits.length - 1];
        const branch = (e.payload.ref ?? "").replace("refs/heads/", "");
        const n = e.payload.size ?? commits.length;
        list.push({
          type: "push",
          repo,
          title: head?.message?.split("\n")[0] ?? `推送 ${n} 个提交`,
          url: `https://github.com/${repo}/commits/${branch}`,
          at,
          detail: `${n} 个提交 · ${branch}`,
        });
        break;
      }
      case "IssuesEvent":
        list.push({
          type: "issue",
          repo,
          title: e.payload.issue?.title ?? "Issue",
          url: e.payload.issue?.html_url ?? `https://github.com/${repo}/issues`,
          at,
          detail: e.payload.action === "opened" ? "新开 Issue" : `Issue ${e.payload.action}`,
        });
        break;
      case "PullRequestEvent":
        list.push({
          type: "pr",
          repo,
          title: e.payload.pull_request?.title ?? "Pull Request",
          url: e.payload.pull_request?.html_url ?? `https://github.com/${repo}/pulls`,
          at,
          detail: `PR ${e.payload.action}`,
        });
        break;
      case "CreateEvent":
        list.push({
          type: "create",
          repo,
          title: `新建 ${e.payload.ref_type === "repository" ? "仓库" : e.payload.ref_type === "branch" ? "分支" : "标签"}`,
          url: `https://github.com/${repo}`,
          at,
          detail: e.payload.ref ?? "",
        });
        break;
      case "ReleaseEvent":
        list.push({
          type: "release",
          repo,
          title: e.payload.release?.name ?? "发布",
          url: e.payload.release?.html_url ?? `https://github.com/${repo}/releases`,
          at,
          detail: "发布版本",
        });
        break;
      case "WatchEvent":
        list.push({
          type: "star",
          repo,
          title: "Star 了仓库",
          url: `https://github.com/${repo}`,
          at,
        });
        break;
      default:
        break;
    }
  }
  return list.slice(0, 30);
}

export async function fetchSnapshot(publicLogin?:string): Promise<GithubSnapshot> {
  const token = publicLogin?"":getGithubToken()||"";
  const login=publicLogin||getCredential("github")?.username||readSecrets().githubLogin;
  if (!login) throw new AppError("请先填写 GitHub 用户名或 Token", 400);
  const [user, repos, events] = await Promise.all([
    gh<GhUser>(token?"/user":`/users/${encodeURIComponent(login)}`, token),
    gh<GhRepo[]>(
      token?"/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member":`/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`,
      token,
    ),
    gh<GhEvent[]>(`/users/${encodeURIComponent(login)}/events?per_page=50`, token),
  ]);

  const mapped: GithubRepo[] = repos.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    description: r.description,
    private: r.private,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    pushedAt: r.pushed_at,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
    archived: r.archived,
  }));

  const activity = mapActivity(events);
  const since = Date.now() - 7 * 86400_000;
  const commits7d = events
    .filter((e) => e.type === "PushEvent" && new Date(e.created_at).getTime() >= since)
    .reduce((s, e) => s + (e.payload.size ?? e.payload.commits?.length ?? 0), 0);

  return {
    login: user.login,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url,
    fetchedAt: new Date().toISOString(),
    repos: mapped,
    activity,
    commits7d,
    openIssues: mapped.reduce((s, r) => s + r.openIssues, 0),
    openPRs: 0,
  };
}

export async function repoDetail(fullName: string) {
  if(!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(fullName)||fullName.split('/').some(p=>p==='.'||p==='..'))throw new AppError("仓库名称格式不正确",400);
  const token = getGithubToken();
  if (!token) throw new AppError("尚未连接 GitHub", 400);
  const [repo, commits, issues, pulls] = await Promise.all([
    gh<GhRepo>(`/repos/${fullName}`, token),
    gh<{ sha: string; commit: { message: string; author: { date: string; name: string } }; html_url: string }[]>(
      `/repos/${fullName}/commits?per_page=6`,
      token,
    ),
    gh<{ title: string; number: number; html_url: string; created_at: string; user: { login: string } }[]>(
      `/repos/${fullName}/issues?state=open&per_page=8`,
      token,
    ),
    gh<{ title: string; number: number; html_url: string; created_at: string; user: { login: string } }[]>(
      `/repos/${fullName}/pulls?state=open&per_page=8`,
      token,
    ),
  ]);
  return {
    repo: {
      fullName: repo.full_name,
      description: repo.description,
      openIssues: repo.open_issues_count,
      pushedAt: repo.pushed_at,
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      stars: repo.stargazers_count,
    },
    commits: commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    })),
    issues: issues.map((i) => ({
      title: i.title,
      number: i.number,
      url: i.html_url,
      createdAt: i.created_at,
      user: i.user?.login ?? "",
    })),
    pulls: pulls.map((p) => ({
      title: p.title,
      number: p.number,
      url: p.html_url,
      createdAt: p.created_at,
      user: p.user?.login ?? "",
    })),
  };
}
