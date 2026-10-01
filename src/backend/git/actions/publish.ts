import { GitError, type GitPublish, type GitResult } from "../../../contracts/git.js";
import { gitCommand, gitText } from "../command.js";
import type { Hosting } from "../hosting/index.js";
import { pushCurrentBranch } from "./push.js";

const normalize = (url: string) => url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "").replace(/^git@([^:]+):/, "ssh://$1/").replace(/^(ssh:\/\/)git@/, "$1").replace(/^https?:\/\//, "ssh://");
/** Reuses a remote already pointing at the repository, else adds one under the preferred name or the first free `-N` variant. */
export async function ensureRemote(root: string, preferred: string, url: string, signal: AbortSignal) {
  const remotes = (await gitText(root, ["remote"], { signal })).split("\n").filter(Boolean);
  for (const remote of remotes) {
    const existing = await gitCommand(root, ["remote", "get-url", remote], { signal, allowed: [0, 2, 128] });
    if (existing.code === 0 && normalize(existing.stdout.toString("utf8")) === normalize(url)) return remote;
  }
  let name = preferred;
  for (let suffix = 1; remotes.includes(name); suffix++) name = `${preferred}-${suffix}`;
  await gitCommand(root, ["check-ref-format", `refs/remotes/${name}/probe`], { signal }).catch(() => { throw new GitError({ code: "INVALID", message: "Enter a valid remote name." }); });
  await gitCommand(root, ["remote", "add", "--", name, url], { signal });
  return name;
}
/** Creates the hosted repository, connects it as a remote and pushes the current branch when there is a commit to push. */
export async function publishRepository(root: string, hosting: Hosting, input: GitPublish, branch: string | null, signal: AbortSignal): Promise<NonNullable<GitResult["publish"]>> {
  const [owner, ...rest] = input.repository.trim().split("/");
  if (!owner || !rest.join("/") || rest.some(part => !part)) throw new GitError({ code: "INVALID", message: "Enter the repository as owner/name." });
  if (input.remote.startsWith("-")) throw new GitError({ code: "INVALID", message: "Enter a valid remote name." });
  const created = await hosting.createRepository(root, { repository: input.repository.trim(), visibility: input.visibility }, signal);
  const remote = await ensureRemote(root, input.remote.trim() || "origin", input.protocol === "https" ? created.httpsUrl : created.sshUrl, signal);
  const head = await gitCommand(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { signal, allowed: [0, 1, 128] });
  if (head.code !== 0 || !branch) return { repository: created.nameWithOwner, url: created.url, remote, pushed: false, branch: branch ?? "main" };
  const pushed = await pushCurrentBranch(root, { branch, upstream: null, remotes: [remote], ahead: 1, behind: 0 }, signal);
  return { repository: created.nameWithOwner, url: created.url, remote, pushed: true, branch: pushed.branch };
}
