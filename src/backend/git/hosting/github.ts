import { GitError, type GitPullRequest } from "../../../contracts/git.js";
import { GH, hostingCommand, parseJson } from "./cli.js";
import { newestFirst, type Hosting } from "./types.js";

type Listed = { number: number; title: string; url: string; baseRefName: string; headRefName: string; state: string; updatedAt?: string; headRepositoryOwner?: { login?: string } | null };
const state = (value: string): GitPullRequest["state"] => value.toUpperCase() === "MERGED" ? "merged" : value.toUpperCase() === "OPEN" ? "open" : "closed";
const text = (output: Buffer) => output.toString("utf8").trim();

export const github: Hosting = {
  kind: "github", name: "GitHub", host: "github.com",
  async changeRequests(cwd, head, wanted, signal) {
    const result = await hostingCommand(GH, cwd, ["pr", "list", "--head", head.headBranch, "--state", wanted, "--limit", "100",
      "--json", "number,title,url,baseRefName,headRefName,state,updatedAt,headRepositoryOwner"], { signal });
    const listed = parseJson<Listed[]>(result.stdout, GH.label), updated = new Map<GitPullRequest, number>();
    const matches = listed.filter(item => item.headRefName === head.headBranch && (!head.owner || !item.headRepositoryOwner?.login || item.headRepositoryOwner.login.toLowerCase() === head.owner.toLowerCase()))
      .map(item => {
        const request: GitPullRequest = { number: item.number, title: item.title, url: item.url, baseBranch: item.baseRefName, headBranch: item.headRefName, state: state(item.state) };
        updated.set(request, Date.parse(item.updatedAt ?? "") || 0);
        return request;
      });
    return newestFirst(matches, updated);
  },
  async changeRequest(cwd, number, signal) {
    const item = parseJson<Listed & { isCrossRepository?: boolean }>((await hostingCommand(GH, cwd, ["pr", "view", String(number),
      "--json", "number,title,url,baseRefName,headRefName,state,isCrossRepository,headRepositoryOwner"], { signal })).stdout, GH.label);
    return { number: item.number, title: item.title, url: item.url, baseBranch: item.baseRefName, headBranch: item.headRefName, state: state(item.state),
      crossRepository: item.isCrossRepository === true, headOwner: item.headRepositoryOwner?.login ?? null };
  },
  async checkoutChangeRequest(cwd, number, branch, signal) {
    await hostingCommand(GH, cwd, ["pr", "checkout", String(number), "--force", ...(branch ? ["--branch", branch] : [])], { signal, timeout: 300_000 });
  },
  async createChangeRequest(cwd, input, signal) {
    await hostingCommand(GH, cwd, ["pr", "create", "--base", input.base, "--head", input.head.selector, "--title", input.title, "--body-file", input.bodyFile], { signal, timeout: 120_000 });
  },
  async defaultBranch(cwd, signal) {
    const name = text((await hostingCommand(GH, cwd, ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { signal })).stdout);
    return name || null;
  },
  async createRepository(cwd, input, signal) {
    const output = text((await hostingCommand(GH, cwd, ["repo", "create", input.repository, `--${input.visibility}`], { signal, timeout: 120_000 })).stdout);
    // gh prints the new repository's URL; reading it avoids racing the API for a repository that was just created.
    const url = /https:\/\/[^\s]+/.exec(output)?.[0] ?? `https://github.com/${input.repository}`;
    const parsed = new URL(url), nameWithOwner = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "") || input.repository;
    return { nameWithOwner, url: `https://${parsed.host}/${nameWithOwner}`, sshUrl: `git@${parsed.host}:${nameWithOwner}.git`, httpsUrl: `https://${parsed.host}/${nameWithOwner}.git` };
  },
  async identity(cwd, signal) {
    const output = (await hostingCommand(GH, cwd, ["api", "user", "--jq", '[.login, (.id | tostring), (.name // "")] | join("\\n")'], { signal, timeout: 15_000 })).stdout.toString("utf8");
    const [login = "", id = "", name = ""] = output.split("\n").map(line => line.trim());
    if (!login || !/^\d+$/.test(id)) throw new GitError({ code: "COMMAND", message: `${GH.label} returned an account Flame could not read.` });
    // GitHub's private address links commits to the account without exposing a real email.
    return { name: name || login, email: `${id}+${login}@users.noreply.github.com` };
  },
  async protocol(cwd, signal) {
    const result = await hostingCommand(GH, cwd, ["config", "get", "git_protocol", "--host", "github.com"], { signal, timeout: 10_000, allowed: [0, 1] }).catch(() => null);
    return result?.stdout.toString("utf8").trim() === "ssh" ? "ssh" : "https";
  },
  async account(cwd, signal) {
    return text((await hostingCommand(GH, cwd, ["api", "user", "--jq", ".login"], { signal, timeout: 15_000 })).stdout);
  },
};
