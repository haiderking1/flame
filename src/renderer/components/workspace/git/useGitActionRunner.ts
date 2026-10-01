import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { GitAction, GitOperation, GitPublish, GitStart, GitStatus } from "@contracts/git";
import type { ModelSelection } from "@contracts/models";
import { gitStart, gitErrorMessage } from "../../../backend/git";
import { toastStore } from "../../toasts/toastStore";
import { defaultBranchCopy, firstProgressLabel, requiresDefaultBranchConfirmation, terminology, type DefaultBranchCopy } from "./gitActionLogic";

export type RunInput = { action: GitAction; message?: string; filePaths?: readonly string[] | null; featureBranch?: boolean; skipDefaultBranchPrompt?: boolean; publish?: GitPublish | null };
export type PendingConfirmation = { input: RunInput; copy: DefaultBranchCopy };
// Operations whose progress this window shows as toasts, kept per project across remounts.
const tracked = new Map<string, Set<string>>();
const trackedFor = (projectId: string) => { let set = tracked.get(projectId); if (!set) tracked.set(projectId, set = new Set()); return set; };
const failureTitle = (action: GitAction) => action === "pull" ? "Pull failed" : action === "init" ? "Git initialization failed" : action === "publish" ? "Publish failed" : "Action failed";
export const openExternal = (url: string) => { window.open(url, "_blank", "noopener"); };

/** Mirrors one operation into its toast: live phase and hook progress, then the result with its call to action, or the failure. */
function showOperation(operation: GitOperation, projectId: string, run: (input: RunInput) => void) {
  const id = `git:${operation.requestId}`;
  if (operation.state === "running") {
    toastStore.show({ id, scope: projectId, type: "loading", title: operation.hook ? `Running ${operation.hook.name}...` : operation.phase || "Running git action...",
      description: operation.hook?.output ?? null, since: operation.hook?.startedAt ?? operation.phaseStartedAt });
    return false;
  }
  if (operation.state === "completed") {
    const toast = operation.result?.toast, cta = toast?.cta;
    toastStore.show({ id, scope: projectId, type: "success", title: toast?.title ?? "Done", description: toast?.description ?? null, dismissAfterVisibleMs: 10_000,
      action: cta?.kind === "run_action" ? { label: cta.label, run: () => run({ action: cta.action }) } : cta?.kind === "open_pr" ? { label: cta.label, run: () => openExternal(cta.url) } : null });
  } else {
    const detail = operation.detail ?? (operation.state === "interrupted" ? "The action was interrupted. Inspect repository state before retrying." : "Git failed.");
    toastStore.show({ id, scope: projectId, type: "error", title: failureTitle(operation.action), description: detail, copy: detail });
  }
  return true;
}
/**
 * Starts Git actions the way t3code does: immediately, with a progress toast, except that pushing or opening a change
 * request from the default branch first asks for confirmation. Progress comes from the durable operation stream, so a
 * reload keeps showing an action that is still running.
 */
export function useGitActionRunner(projectId: string, status: GitStatus | null, operations: readonly GitOperation[] | null, model: ModelSelection | null) {
  const start = useAtomSet(gitStart, { mode: "promise" });
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [starting, setStarting] = useState(0);
  const latest = useRef({ status, model }); latest.current = { status, model };
  // Blocks a second start (e.g. a double click) before the first acceptance re-renders the control as busy.
  const inFlight = useRef(false);
  const run = useCallback((input: RunInput): Promise<string | null> => {
    const { status, model } = latest.current;
    const includesCommit = (input.action === "commit" || input.action === "commit_push" || input.action === "commit_push_pr") && (input.action === "commit" || (status?.files.length ?? 0) > 0 || !!input.featureBranch);
    if (!input.skipDefaultBranchPrompt && !input.featureBranch && status?.branch && requiresDefaultBranchConfirmation(input.action, status.isDefaultBranch)) {
      setPending({ input, copy: defaultBranchCopy(input.action, status.branch, includesCommit, terminology(status)) });
      return Promise.resolve(null);
    }
    const request: GitStart = { projectId, requestId: crypto.randomUUID(), action: input.action, message: input.message?.trim() ?? "",
      filePaths: input.filePaths?.length ? input.filePaths : null, featureBranch: !!input.featureBranch,
      expectedBranch: input.action === "init" || input.action === "publish" ? null : status?.branch ?? null, model, publish: input.publish ?? null };
    if (inFlight.current) return Promise.resolve(null);
    inFlight.current = true;
    const id = `git:${request.requestId}`, toast = input.action !== "publish";
    if (toast) {
      trackedFor(projectId).add(request.requestId);
      toastStore.show({ id, scope: projectId, type: "loading", title: firstProgressLabel({ action: input.action, message: request.message, featureBranch: request.featureBranch, status }), description: "Waiting for Git...", since: null });
    }
    setStarting(value => value + 1);
    return start(request).then(() => request.requestId, error => {
      trackedFor(projectId).delete(request.requestId);
      const message = gitErrorMessage(error);
      if (toast) toastStore.show({ id, scope: projectId, type: "error", title: failureTitle(input.action), description: message, copy: message });
      throw error;
    }).finally(() => { inFlight.current = false; setStarting(value => value - 1); });
  }, [projectId, start]);
  const runSafely = useCallback((input: RunInput) => { void run(input).catch(() => { /* Reported in its toast. */ }); }, [run]);
  useEffect(() => {
    if (!operations) return;
    const watched = trackedFor(projectId);
    for (const operation of operations) {
      // An action still running when this window (re)connected gets its progress toast back.
      if (operation.state === "running" && operation.action !== "publish") watched.add(operation.requestId);
      if (!watched.has(operation.requestId)) continue;
      if (showOperation(operation, projectId, runSafely)) watched.delete(operation.requestId);
    }
  }, [operations, projectId, runSafely]);
  return {
    run, runSafely, starting: starting > 0, pending,
    confirm(choice: "continue" | "feature" | "abort") {
      const current = pending; setPending(null);
      if (!current || choice === "abort") return;
      runSafely({ ...current.input, skipDefaultBranchPrompt: true, ...(choice === "feature" ? { featureBranch: true } : {}) });
    },
  };
}
