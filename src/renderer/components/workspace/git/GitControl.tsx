import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { gitOperations } from "../../../backend/git";
import type { WorkspaceKey } from "../../../backend/workspaceKey";
import { WorkspaceIcon, type WorkspaceIconName } from "../WorkspaceIcon";
import { useGitStatus } from "./useGitStatus";
import { useGitStatusTriggers } from "./useGitStatusTriggers";
import { useGitModel } from "./useGitModel";
import { openExternal, useGitActionRunner } from "./useGitActionRunner";
import { resolveQuickAction, type QuickAction } from "./gitActionLogic";
import { GitActionsMenu } from "./GitActionsMenu";
import { HoverHint } from "./HoverHint";
import "./git-actions.css";

const loadCommit = () => import("./CommitDialog"), loadPublish = () => import("./PublishDialog"), loadConfirm = () => import("./DefaultBranchDialog");
const CommitDialog = lazy(loadCommit), PublishDialog = lazy(loadPublish), DefaultBranchDialog = lazy(loadConfirm);
function quickIcon(quick: QuickAction): WorkspaceIconName {
  if (quick.kind === "open_pr") return "pull-request";
  if (quick.kind === "open_publish") return "cloud-upload";
  if (quick.kind === "run_pull") return "cloud-download";
  if (quick.kind === "run_action") return quick.action === "commit" ? "commit" : quick.action === "create_pr" || quick.action === "commit_push_pr" ? "pull-request" : "cloud-upload";
  return quick.label === "Commit" ? "commit" : quick.label === "Push" ? "cloud-upload" : "info";
}
/** t3code's Git control for a workspace (project checkout or session worktree): one context-aware action button, an options menu, and the commit, publish and default-branch dialogs. */
export function GitControl({ workspace }: { workspace: WorkspaceKey }) {
  const git = useGitStatus(workspace), { status, error, refresh } = git;
  useGitStatusTriggers(workspace, refresh);
  const operations = useAtomValue(gitOperations(workspace));
  const list = AsyncResult.isSuccess(operations) ? operations.value : null;
  const running = !!list?.some(operation => operation.state === "running");
  const runner = useGitActionRunner(workspace, status, list, useGitModel());
  const busy = running || runner.starting;
  const [dialog, setDialog] = useState<"commit" | "publish" | null>(null);
  const menuId = useId(), anchor = `--git-menu-${menuId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const options = useRef<HTMLButtonElement>(null), primary = useRef<HTMLButtonElement>(null);
  // Dialog code loads after first paint, so opening one never waits on the network or disk.
  useEffect(() => {
    const preload = () => { void loadCommit(); void loadPublish(); void loadConfirm(); };
    const handle = window.requestIdleCallback ? window.requestIdleCallback(preload, { timeout: 2000 }) : window.setTimeout(preload, 200);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(handle); else window.clearTimeout(handle); };
  }, []);
  const quick = resolveQuickAction(status, busy);
  function runQuick() {
    if (quick.kind === "run_action") runner.runSafely({ action: quick.action });
    else if (quick.kind === "run_pull") runner.runSafely({ action: "pull" });
    else if (quick.kind === "open_pr" && status?.pr) openExternal(status.pr.url);
    else if (quick.kind === "open_publish") setDialog("publish");
  }
  const dialogs = <Suspense fallback={null}>
    {dialog === "commit" && status && <CommitDialog workspace={workspace} status={status} onClose={() => { setDialog(null); options.current?.focus(); }}
      onCommit={input => { setDialog(null); runner.runSafely({ action: "commit", ...input }); }} />}
    {dialog === "publish" && <PublishDialog workspace={workspace} run={runner.run} onClose={() => { setDialog(null); primary.current?.focus(); void refresh("sync"); }} />}
    {runner.pending && <DefaultBranchDialog copy={runner.pending.copy} onChoose={runner.confirm} />}
  </Suspense>;
  if (status && !status.repository) {
    const initializing = !!list?.some(operation => operation.state === "running" && operation.action === "init");
    return <div className="git-control" role="group" aria-label="Git actions">
      <button ref={primary} type="button" className="git-control__button git-control__button--solo" aria-label="Initialize Git" disabled={busy}
        onClick={() => runner.runSafely({ action: "init" })}><WorkspaceIcon name="branch-plus" /><span className="git-control__label">{initializing ? "Initializing..." : "Initialize Git"}</span></button>
    </div>;
  }
  const button = <button ref={primary} type="button" className="git-control__button git-control__primary" aria-label={quick.label} title={quick.disabled ? undefined : quick.label}
    aria-disabled={quick.disabled || undefined} onClick={() => { if (!quick.disabled) runQuick(); }}>
    <WorkspaceIcon name={quickIcon(quick)} /><span className="git-control__label">{quick.label}</span>
  </button>;
  return <div className="git-control" role="group" aria-label="Git actions">
    <HoverHint hint={quick.disabled ? quick.hint : null} side="bottom" className="git-control__hint">{button}</HoverHint>
    <span className="git-control__separator" aria-hidden="true" />
    <button ref={options} type="button" className="git-control__button git-control__options" style={{ anchorName: anchor }} aria-label="Git action options" aria-haspopup="menu" aria-controls={menuId}
      popoverTarget={menuId} disabled={busy}><WorkspaceIcon name="chevron" /></button>
    <GitActionsMenu id={menuId} anchor={anchor} status={status} busy={busy} error={error}
      onToggle={open => { if (open) void refresh("check"); }}
      onPublish={() => setDialog("publish")}
      onItem={item => {
        if (item.kind === "open_dialog") setDialog("commit");
        else if (item.kind === "open_pr" && status?.pr) openExternal(status.pr.url);
        else if (item.action) runner.runSafely({ action: item.action });
      }} />
    {dialogs}
  </div>;
}
