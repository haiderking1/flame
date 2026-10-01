import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitError, type GitResult } from "../../../contracts/git.js";
import { changeRequestTerminology } from "../../../contracts/source-control.js";
import type { ModelSelection } from "../../../contracts/models.js";
import { gitCommand } from "../command.js";
import { defaultBranch, PRIMARY_REMOTE } from "../branch-state.js";
import { headContext } from "../head-context.js";
import type { Hosting } from "../hosting/index.js";
import { changeRequestPrompt } from "../writer/prompts.js";
import { repositoryConventions } from "../writer/conventions.js";
import { pullRequestTemplate } from "../writer/template.js";
import type { ActionContext } from "./context.js";

type ChangeRequest = NonNullable<GitResult["pr"]>;
const capped = async (root: string, args: string[], signal: AbortSignal, max: number) => {
  const result = await gitCommand(root, args, { signal, allowed: [0, 128], maxBytes: 16 * 1024 * 1024 }).catch(error => { if (signal.aborted) throw error; return null; });
  if (!result || result.code !== 0) return "";
  return result.stdout.length > max ? `${result.stdout.subarray(0, max).toString("utf8")}\n\n[truncated]` : result.stdout.toString("utf8");
};
async function config(root: string, key: string, signal: AbortSignal) {
  const result = await gitCommand(root, ["config", "--get", key], { signal, allowed: [0, 1] });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
}
/** Target branch: the recorded merge base, a differently named upstream, the host's default branch, origin/HEAD, then main. */
async function baseBranch(root: string, hosting: Hosting, branch: string, upstreamBranch: string | null, crossRepository: boolean, signal: AbortSignal) {
  const recorded = await config(root, `branch.${branch}.gh-merge-base`, signal);
  if (recorded) return recorded;
  if (upstreamBranch && upstreamBranch !== branch && !crossRepository) return upstreamBranch;
  const hosted = await hosting.defaultBranch(root, signal).catch(error => { if (signal.aborted) throw error; return null; });
  return hosted ?? await defaultBranch(root, signal) ?? "main";
}
/** Opens the existing change request for this branch, or writes and creates one against the base branch. */
export async function openChangeRequest(context: ActionContext, hosting: Hosting, state: { branch: string | null; upstream: string | null }, model: ModelSelection | null): Promise<ChangeRequest> {
  const { root, signal, progress } = context, terminology = changeRequestTerminology(hosting.kind);
  if (!state.branch) throw new GitError({ code: "INVALID", message: `Cannot create a ${terminology.singular} from detached HEAD.` });
  if (!state.upstream) throw new GitError({ code: "INVALID", message: `Current branch has not been pushed. Push before creating a ${terminology.shortLabel}.` });
  progress.phase("pr", `Preparing ${terminology.shortLabel}...`);
  const head = await headContext(root, state.branch, state.upstream, signal);
  const existing = (await hosting.changeRequests(root, head, "open", signal))[0];
  if (existing) return { status: "opened_existing", number: existing.number, url: existing.url, title: existing.title, baseBranch: existing.baseBranch, headBranch: existing.headBranch };
  const upstreamBranch = state.upstream.includes("/") ? state.upstream.slice(state.upstream.indexOf("/") + 1) : null;
  const base = await baseBranch(root, hosting, state.branch, upstreamBranch, head.crossRepository, signal);
  const remoteBase = await gitCommand(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${PRIMARY_REMOTE}/${base}^{commit}`], { signal, allowed: [0, 1] });
  const range = remoteBase.code === 0 ? remoteBase.stdout.toString("utf8").trim() : base;
  progress.phase("pr", `Generating ${terminology.shortLabel} content...`);
  const [commits, stat, patch, conventions, template] = await Promise.all([
    capped(root, ["log", "--oneline", `${range}..HEAD`, "--"], signal, 19_000),
    capped(root, ["diff", "--stat", `${range}...HEAD`, "--"], signal, 19_000),
    capped(root, ["diff", "--no-ext-diff", "--patch", "--minimal", `${range}...HEAD`, "--"], signal, 59_000),
    repositoryConventions(root, "change request", signal),
    hosting.kind === "github" ? pullRequestTemplate(root, range, signal) : Promise.resolve(null),
  ]);
  const text = await context.writer.changeRequest(changeRequestPrompt({ base, head: head.headBranch, commits, stat, patch, template, conventions, singular: terminology.singular }), model, signal);
  progress.phase("pr", `Creating ${terminology.singular}...`);
  const directory = await mkdtemp(join(tmpdir(), "flame-change-request-"));
  try {
    const bodyFile = join(directory, "body.md");
    await writeFile(bodyFile, text.body, { mode: 0o600 });
    await hosting.createChangeRequest(root, { base, head, title: text.title, bodyFile }, signal);
  } finally { await rm(directory, { recursive: true, force: true }); }
  const created = (await hosting.changeRequests(root, head, "open", signal).catch(() => []))[0];
  return { status: "created", number: created?.number ?? null, url: created?.url ?? null, title: created?.title ?? text.title, baseBranch: created?.baseBranch ?? base, headBranch: head.headBranch };
}
