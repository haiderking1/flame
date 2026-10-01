import { GitError, type GitPullRequest } from "../../../contracts/git.js";
import { GLAB, hostingCommand, parseJson } from "./cli.js";
import { newestFirst, type Hosting } from "./types.js";

type Listed = { iid: number; title: string; web_url: string; target_branch: string; source_branch: string; state: string; updated_at?: string };
type Project = { path_with_namespace: string; web_url: string; ssh_url_to_repo: string; http_url_to_repo: string };
const state = (value: string): GitPullRequest["state"] => value === "merged" ? "merged" : value === "opened" ? "open" : "closed";

export const gitlab: Hosting = {
  kind: "gitlab", name: "GitLab", host: "gitlab.com",
  async changeRequests(cwd, head, wanted, signal) {
    const query = new URLSearchParams({ source_branch: head.headBranch, state: wanted === "open" ? "opened" : "all", per_page: "100", order_by: "updated_at" });
    const listed = parseJson<Listed[]>((await hostingCommand(GLAB, cwd, ["api", `projects/:fullpath/merge_requests?${query}`], { signal })).stdout, GLAB.label);
    const updated = new Map<GitPullRequest, number>();
    const matches = listed.filter(item => item.source_branch === head.headBranch).map(item => {
      const request: GitPullRequest = { number: item.iid, title: item.title, url: item.web_url, baseBranch: item.target_branch, headBranch: item.source_branch, state: state(item.state) };
      updated.set(request, Date.parse(item.updated_at ?? "") || 0);
      return request;
    });
    return newestFirst(matches, updated);
  },
  async changeRequest(cwd, number, signal) {
    const item = parseJson<Listed & { source_project_id?: number; target_project_id?: number; author?: { username?: string } }>(
      (await hostingCommand(GLAB, cwd, ["api", `projects/:fullpath/merge_requests/${number}`], { signal })).stdout, GLAB.label);
    const crossRepository = item.source_project_id !== undefined && item.source_project_id !== item.target_project_id;
    return { number: item.iid, title: item.title, url: item.web_url, baseBranch: item.target_branch, headBranch: item.source_branch, state: state(item.state),
      crossRepository, headOwner: crossRepository ? item.author?.username ?? null : null };
  },
  async checkoutChangeRequest(cwd, number, branch, signal) {
    await hostingCommand(GLAB, cwd, ["mr", "checkout", String(number), ...(branch ? ["--branch", branch] : [])], { signal, timeout: 300_000 });
  },
  async createChangeRequest(cwd, input, signal) {
    await hostingCommand(GLAB, cwd, ["api", "--method", "POST", "projects/:fullpath/merge_requests", "--raw-field", `source_branch=${input.head.headBranch}`,
      "--raw-field", `target_branch=${input.base}`, "--raw-field", `title=${input.title}`, "--field", `description=@${input.bodyFile}`], { signal, timeout: 120_000 });
  },
  async defaultBranch(cwd, signal) {
    const project = parseJson<{ default_branch?: string | null }>((await hostingCommand(GLAB, cwd, ["api", "projects/:fullpath"], { signal })).stdout, GLAB.label);
    return project.default_branch || null;
  },
  async createRepository(cwd, input, signal) {
    const parts = input.repository.split("/"), name = parts.pop()!, namespace = parts.join("/");
    const fields = ["--raw-field", `name=${name}`, "--raw-field", `path=${name}`, "--raw-field", `visibility=${input.visibility}`];
    if (namespace && namespace.toLowerCase() !== (await this.account(cwd, signal)).toLowerCase()) {
      const found = parseJson<{ id?: number }>((await hostingCommand(GLAB, cwd, ["api", `namespaces/${encodeURIComponent(namespace)}`], { signal })).stdout, GLAB.label);
      if (typeof found.id !== "number") throw new GitError({ code: "INVALID", message: `GitLab namespace "${namespace}" was not found or is not accessible.` });
      fields.push("--raw-field", `namespace_id=${found.id}`);
    }
    const project = parseJson<Project>((await hostingCommand(GLAB, cwd, ["api", "--method", "POST", "projects", ...fields], { signal, timeout: 120_000 })).stdout, GLAB.label);
    return { nameWithOwner: project.path_with_namespace, url: project.web_url, sshUrl: project.ssh_url_to_repo, httpsUrl: project.http_url_to_repo };
  },
  async identity(cwd, signal) {
    const user = parseJson<{ id?: number; username?: string; name?: string; commit_email?: string | null }>((await hostingCommand(GLAB, cwd, ["api", "user"], { signal, timeout: 15_000 })).stdout, GLAB.label);
    if (!user.username || typeof user.id !== "number") throw new GitError({ code: "COMMAND", message: `${GLAB.label} returned an account Flame could not read.` });
    return { name: user.name || user.username, email: user.commit_email || `${user.id}-${user.username}@users.noreply.gitlab.com` };
  },
  async protocol(cwd, signal) {
    const result = await hostingCommand(GLAB, cwd, ["config", "get", "git_protocol", "--host", "gitlab.com"], { signal, timeout: 10_000, allowed: [0, 1] }).catch(() => null);
    return result?.stdout.toString("utf8").trim() === "ssh" ? "ssh" : "https";
  },
  async account(cwd, signal) {
    const user = parseJson<{ username?: string }>((await hostingCommand(GLAB, cwd, ["api", "user"], { signal, timeout: 15_000 })).stdout, GLAB.label);
    if (!user.username) throw new GitError({ code: "INVALID", message: `${GLAB.label} is not authenticated. Run \`glab auth login\` and retry.` });
    return user.username;
  },
};
