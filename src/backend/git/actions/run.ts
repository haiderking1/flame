import { GitError, type GitOperation, type GitPhase, type GitResult } from "../../../contracts/git.js";
import { changeRequestTerminology } from "../../../contracts/source-control.js";
import { gitCommand } from "../command.js";
import { repositoryStatus } from "../status.js";
import { hostingFor, type Hosting } from "../hosting/index.js";
import { headContext } from "../head-context.js";
import { commitIdentity } from "../identity.js";
import { commitPrompt } from "../writer/prompts.js";
import { repositoryConventions } from "../writer/conventions.js";
import { sanitizeFeatureBranchName } from "../branch-names.js";
import { assertNoConflicts, commitStaged, splitMessage, stageChanges, type StagedChanges } from "./commit.js";
import { switchToFeatureBranch } from "./feature-branch.js";
import { pushCurrentBranch } from "./push.js";
import { pullCurrentBranch } from "./pull.js";
import { publishRepository } from "./publish.js";
import { openChangeRequest } from "./change-request.js";
import { completionToast } from "./toast.js";
import type { ActionContext } from "./context.js";

type Draft = { -readonly [Key in keyof Omit<GitResult, "toast">]: GitResult[Key] };
const empty = (): Draft => ({ branch: null, commit: null, push: null, pr: null, pull: null, publish: null });
const requireHosting = (hosting: Hosting | null, singular: string) => {
  if (!hosting) throw new GitError({ code: "INVALID", message: `Creating a ${singular} needs a GitHub or GitLab remote and its CLI.` });
  return hosting;
};
/** The phases an action will go through, for the progress display. */
export function plannedPhases(operation: Pick<GitOperation, "action" | "featureBranch">, status: { upstream: string | null; ahead: number }): GitPhase[] {
  const { action } = operation;
  if (action === "init" || action === "pull" || action === "publish") return [action];
  const commit = action === "commit" || action === "commit_push" || action === "commit_push_pr";
  const push = action === "push" || action === "commit_push" || action === "commit_push_pr" || (action === "create_pr" && (!status.upstream || status.ahead > 0));
  const pr = action === "create_pr" || action === "commit_push_pr";
  return [...(operation.featureBranch ? ["branch" as const] : []), ...(commit ? ["commit" as const] : []), ...(push ? ["push" as const] : []), ...(pr ? ["pr" as const] : [])];
}
/** Runs one durable Git action end to end and returns its result with the completion toast. */
export async function runAction(context: ActionContext, setPhases: (phases: GitPhase[]) => void): Promise<GitResult> {
  const { root, operation, signal, progress } = context;
  let status = await repositoryStatus(operation.projectId, root, signal);
  if (status.root && status.root !== root) throw new GitError({ code: "INVALID", message: "Select the repository root as a project before using Git actions. No files were changed." });
  const result = empty();
  if (operation.action === "init") {
    setPhases(["init"]);
    if (status.repository) throw new GitError({ code: "INVALID", message: "This project already belongs to a repository." });
    progress.phase("init", "Initializing repository...");
    await gitCommand(root, ["init"], { signal, timeout: 30_000 });
    return { ...result, toast: completionToast("init", result, { kind: null, isDefaultBranch: false, openPrUrl: null }) };
  }
  if (!status.repository) throw new GitError({ code: "INVALID", message: "Initialize a repository first." });
  if (operation.expectedBranch !== null && status.branch !== operation.expectedBranch) throw new GitError({ code: "INVALID", message: "The current branch changed. Refresh Git status before continuing. No files were changed." });
  const hosting = hostingFor(status.provider?.kind), terminology = changeRequestTerminology(status.provider?.kind);
  setPhases(plannedPhases(operation, status));
  if (operation.action === "pull") {
    progress.phase("pull", "Pulling...");
    result.pull = await pullCurrentBranch(root, status.branch, status.upstream, signal);
    return { ...result, toast: completionToast("pull", result, { kind: status.provider?.kind ?? null, isDefaultBranch: status.isDefaultBranch, openPrUrl: null }) };
  }
  if (operation.action === "publish") {
    if (!operation.publish) throw new GitError({ code: "INVALID", message: "Choose where to publish the repository." });
    progress.phase("publish", "Publishing repository...");
    const target = hostingFor(operation.publish.provider)!;
    await target.account(root, signal);
    result.publish = await publishRepository(root, target, operation.publish, status.branch, signal);
    return { ...result, toast: completionToast("publish", result, { kind: target.kind, isDefaultBranch: false, openPrUrl: null }) };
  }
  const { action } = operation;
  const wantsCommit = action === "commit" || action === "commit_push" || action === "commit_push_pr";
  const wantsPr = action === "create_pr" || action === "commit_push_pr";
  const wantsPush = action === "push" || action === "commit_push" || action === "commit_push_pr" || (action === "create_pr" && (!status.upstream || status.ahead > 0));
  if (action === "create_pr" && status.files.length) throw new GitError({ code: "INVALID", message: `Commit local changes before creating a ${terminology.shortLabel}.` });
  if (!operation.featureBranch) {
    if (wantsPush && !status.branch) throw new GitError({ code: "INVALID", message: "Cannot push from detached HEAD." });
    if (wantsPr && !status.branch) throw new GitError({ code: "INVALID", message: `Cannot create a ${terminology.singular} from detached HEAD.` });
  }
  if (wantsPr) requireHosting(hosting, terminology.singular);
  // Settle who the author is before staging or generating anything, so a missing identity fails cleanly.
  const identity = wantsCommit ? await commitIdentity(root, status.provider?.kind ?? null, signal) : {};
  const custom = operation.message.trim() ? splitMessage(operation.message) : null;
  const draft: { staged: StagedChanges | null; message: { subject: string; body: string } | null } = { staged: null, message: custom };
  // Stages the commit and settles its message (generating one when none was given); returns a suggested branch name.
  const prepare = async (includeBranch: boolean) => {
    assertNoConflicts(status.files);
    const staged = draft.staged = await stageChanges(root, operation.filePaths, signal);
    if (!staged) return null;
    if (custom) return includeBranch ? sanitizeFeatureBranchName(custom.subject) : null;
    const generated = await context.writer.commit(commitPrompt({ branch: status.branch, summary: staged.summary, patch: staged.patch, includeBranch,
      conventions: await repositoryConventions(root, "commit", signal) }), operation.model, includeBranch, signal);
    draft.message = { subject: generated.subject, body: generated.body };
    return generated.branch;
  };
  if (operation.featureBranch && !wantsCommit) {
    // Moving existing local commits: the new branch is named after the latest commit and starts at HEAD.
    progress.phase("branch", "Preparing feature branch...");
    const subject = await gitCommand(root, ["log", "-1", "--format=%s"], { signal, allowed: [0, 128] });
    if (subject.code !== 0) throw new GitError({ code: "INVALID", message: "Cannot create a feature branch before the first commit." });
    result.branch = await switchToFeatureBranch(root, sanitizeFeatureBranchName(subject.stdout.toString("utf8").trim()), signal);
  } else if (operation.featureBranch) {
    progress.phase("branch", "Preparing feature branch...");
    const branch = await prepare(true);
    if (!draft.staged || !draft.message) throw new GitError({ code: "INVALID", message: "Cannot create a feature branch because there are no changes to commit." });
    result.branch = await switchToFeatureBranch(root, sanitizeFeatureBranchName(branch ?? draft.message.subject), signal);
  }
  if (wantsCommit) {
    if (!operation.featureBranch) {
      if (!custom) progress.phase("commit", "Generating commit message...");
      await prepare(false);
    }
    if (draft.staged && draft.message) {
      const { subject, body } = draft.message;
      progress.phase("commit", "Committing...");
      const sha = await commitStaged(root, subject, body, progress.hooks, signal, identity);
      progress.commit(sha);
      result.commit = { sha, subject };
    } else if (action === "commit") throw new GitError({ code: "INVALID", message: "There are no changes to commit." });
  }
  if (wantsPush || wantsPr) status = await repositoryStatus(operation.projectId, root, signal);
  if (wantsPush) {
    // Hooks may switch branches; never push a branch other than the one this action committed on.
    if (status.branch !== (result.branch ?? operation.expectedBranch ?? status.branch)) throw new GitError({ code: "INVALID", message: "The branch changed during the action. No push was attempted." });
    progress.phase("push", "Pushing...");
    result.push = await pushCurrentBranch(root, status, signal);
    status = { ...status, upstream: result.push.upstream };
  }
  if (wantsPr) result.pr = await openChangeRequest(context, hosting!, status, operation.model);
  let openPrUrl: string | null = null;
  if (!result.pr && hosting && result.push && !result.push.skipped && result.branch === null && (action === "push" || action === "commit_push")) {
    openPrUrl = (await headContext(root, result.push.branch, result.push.upstream, signal).then(head => hosting.changeRequests(root, head, "open", signal)).catch(() => []))[0]?.url ?? null;
  }
  return { ...result, toast: completionToast(action, result, { kind: status.provider?.kind ?? null, isDefaultBranch: status.isDefaultBranch, openPrUrl, canPush: status.remotes.length > 0 }) };
}
