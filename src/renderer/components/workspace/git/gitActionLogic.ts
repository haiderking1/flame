import type { GitAction, GitStatus } from "@contracts/git";
import { changeRequestTerminology, DEFAULT_TERMINOLOGY, type ChangeRequestTerminology } from "@contracts/source-control";

/** Which action the header button runs and how it is labelled; ported from t3code's GitActionsControl logic. */
export type QuickAction =
  | { kind: "run_action"; label: string; action: GitAction; disabled: false }
  | { kind: "run_pull"; label: string; disabled: false }
  | { kind: "open_pr"; label: string; disabled: false }
  | { kind: "open_publish"; label: string; disabled: false }
  | { kind: "show_hint"; label: string; hint: string; disabled: true };
export type MenuItem = { id: "commit" | "push" | "pr"; label: string; disabled: boolean; icon: "commit" | "push" | "pr"; kind: "open_dialog" | "run_action" | "open_pr"; action?: GitAction };
export type DefaultBranchCopy = { title: string; description: string; continueLabel: string };

export const terminology = (status: GitStatus | null): ChangeRequestTerminology => status?.provider ? changeRequestTerminology(status.provider.kind) : DEFAULT_TERMINOLOGY;
const hasChanges = (status: GitStatus) => status.files.length > 0;
const hasOpenPr = (status: GitStatus) => status.pr?.state === "open";
/** Change requests are only offered when Flame can open them through the provider's CLI. */
export const supportsChangeRequests = (status: GitStatus) => status.provider?.kind === "github" || status.provider?.kind === "gitlab";

export function resolveQuickAction(status: GitStatus | null, busy: boolean): QuickAction {
  const hint = (label: string, text: string): QuickAction => ({ kind: "show_hint", label, hint: text, disabled: true });
  if (busy) return hint("Commit", "Git action in progress.");
  if (!status) return hint("Commit", "Git status is unavailable.");
  const words = terminology(status), prs = supportsChangeRequests(status);
  const isAhead = status.ahead > 0, isBehind = status.behind > 0, openPr = hasOpenPr(status);
  // Without change-request support, a feature branch behaves like the default branch: push only.
  const pushOnly = status.isDefaultBranch || !prs;
  const run = (label: string, action: GitAction): QuickAction => ({ kind: "run_action", label, action, disabled: false });
  if (status.branch === null) return hint("Commit", `Create and checkout a branch before pushing or opening a ${words.singular}.`);
  if (hasChanges(status)) {
    if (!status.upstream && !status.hasPrimaryRemote) return run("Commit", "commit");
    if (openPr || pushOnly) return run("Commit & push", "commit_push");
    return run(`Commit, push & ${words.shortLabel}`, "commit_push_pr");
  }
  if (!status.upstream) {
    if (!status.hasPrimaryRemote) {
      if (openPr && !isAhead) return { kind: "open_pr", label: `View ${words.shortLabel}`, disabled: false };
      return { kind: "open_publish", label: "Publish repository", disabled: false };
    }
    if (!isAhead) {
      if (openPr) return { kind: "open_pr", label: `View ${words.shortLabel}`, disabled: false };
      return hint("Push", "No local commits to push.");
    }
    if (openPr || pushOnly) return run("Push", status.isDefaultBranch ? "commit_push" : "push");
    return run(`Push & create ${words.shortLabel}`, "create_pr");
  }
  if (isAhead && isBehind) return hint("Sync branch", "Branch has diverged from upstream. Rebase/merge first.");
  if (isBehind) return { kind: "run_pull", label: "Pull", disabled: false };
  if (isAhead) {
    if (openPr || pushOnly) return run("Push", status.isDefaultBranch ? "commit_push" : "push");
    return run(`Push & create ${words.shortLabel}`, "create_pr");
  }
  if (openPr) return { kind: "open_pr", label: `View ${words.shortLabel}`, disabled: false };
  if (status.aheadOfDefault > 0 && !status.isDefaultBranch && prs) return run(`Create ${words.shortLabel}`, "create_pr");
  return hint("Commit", "Branch is up to date. No action needed.");
}

export function buildMenuItems(status: GitStatus | null, busy: boolean): MenuItem[] {
  if (!status) return [];
  const words = terminology(status), branch = status.branch !== null, behind = status.behind > 0, openPr = hasOpenPr(status);
  const canPushWithoutUpstream = status.hasPrimaryRemote && !status.upstream;
  const commit: MenuItem = { id: "commit", label: "Commit", disabled: busy || !hasChanges(status), icon: "commit", kind: "open_dialog" };
  if (!status.hasPrimaryRemote && !status.upstream) return [commit];
  const push: MenuItem = { id: "push", label: "Push", icon: "push", kind: "run_action", action: "push",
    disabled: busy || !branch || behind || status.ahead === 0 || !(status.upstream || canPushWithoutUpstream) };
  if (!supportsChangeRequests(status)) return [commit, push];
  const pr: MenuItem = openPr ? { id: "pr", label: `View ${words.shortLabel}`, icon: "pr", kind: "open_pr", disabled: busy }
    : { id: "pr", label: `Create ${words.shortLabel}`, icon: "pr", kind: "run_action", action: "create_pr",
      disabled: busy || !branch || hasChanges(status) || status.aheadOfDefault === 0 || behind || !(status.upstream || canPushWithoutUpstream) };
  return [commit, push, pr];
}

export function menuDisabledReason(item: MenuItem, status: GitStatus | null, busy: boolean): string | null {
  if (!item.disabled) return null;
  if (busy) return "Git action in progress.";
  if (!status) return "Git status is unavailable.";
  const words = terminology(status), branch = status.branch !== null, changes = hasChanges(status);
  const ahead = status.ahead > 0, behind = status.behind > 0, noRemote = !status.upstream && !status.hasPrimaryRemote;
  if (item.id === "commit") return changes ? "Commit is currently unavailable." : "Worktree is clean. Make changes before committing.";
  if (item.id === "push") {
    if (!branch) return "Detached HEAD: check out a branch before pushing.";
    if (changes) return "Commit or stash local changes before pushing.";
    if (behind) return "Branch is behind upstream. Pull/rebase before pushing.";
    if (noRemote) return 'Add an "origin" remote before pushing.';
    if (!ahead) return "No local commits to push.";
    return "Push is currently unavailable.";
  }
  if (hasOpenPr(status)) return `View ${words.singular} is currently unavailable.`;
  if (!branch) return `Detached HEAD: check out a branch before creating a ${words.singular}.`;
  if (changes) return `Commit local changes before creating a ${words.singular}.`;
  if (noRemote) return `Add an "origin" remote before creating a ${words.singular}.`;
  if (status.aheadOfDefault === 0) return `No local commits to include in a ${words.singular}.`;
  if (behind) return `Branch is behind upstream. Pull/rebase before creating a ${words.singular}.`;
  return `Create ${words.singular} is currently unavailable.`;
}

export function requiresDefaultBranchConfirmation(action: GitAction, isDefaultBranch: boolean) {
  return isDefaultBranch && (action === "push" || action === "create_pr" || action === "commit_push" || action === "commit_push_pr");
}
export function defaultBranchCopy(action: GitAction, branch: string, includesCommit: boolean, words: ChangeRequestTerminology): DefaultBranchCopy {
  const suffix = ` on "${branch}". You can continue on this branch or create a feature branch and run the same action there.`;
  if (action === "push" || action === "commit_push") return includesCommit
    ? { title: "Commit & push to default branch?", description: `This action will commit and push changes${suffix}`, continueLabel: `Commit & push to ${branch}` }
    : { title: "Push to default branch?", description: `This action will push local commits${suffix}`, continueLabel: `Push to ${branch}` };
  return includesCommit
    ? { title: `Commit, push & create ${words.shortLabel} from default branch?`, description: `This action will commit, push, and create a ${words.singular}${suffix}`, continueLabel: `Commit, push & create ${words.shortLabel}` }
    : { title: `Push & create ${words.shortLabel} from default branch?`, description: `This action will push local commits and create a ${words.singular}${suffix}`, continueLabel: `Push & create ${words.shortLabel}` };
}
/** The first progress label to show before the backend reports its own phases. */
export function firstProgressLabel(input: { action: GitAction; message: string; featureBranch: boolean; status: GitStatus | null }): string {
  const words = terminology(input.status), status = input.status;
  if (input.action === "init") return "Initializing repository...";
  if (input.action === "pull") return "Pulling...";
  if (input.action === "publish") return "Publishing repository...";
  if (input.featureBranch) return "Preparing feature branch...";
  if (input.action === "push") return "Pushing...";
  if (input.action === "create_pr") return !status?.upstream || status.ahead > 0 ? "Pushing..." : `Preparing ${words.shortLabel}...`;
  const commits = input.action === "commit" || (status?.files.length ?? 0) > 0;
  if (commits) return input.message.trim() ? "Committing..." : "Generating commit message...";
  return "Pushing...";
}
