import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { GitRef } from "@contracts/worktrees";
import { changeRequestTerminology } from "@contracts/source-control";
import { LOCAL_WORKSPACE } from "@contracts/session-workspace";
import { projectSettings } from "@contracts/worktrees";
import { createSession, deleteSession } from "../../../backend/sessions";
import { preparePullRequest, switchGitRef, worktreeErrorMessage } from "../../../backend/worktrees";
import { workspaceKey, worktreeKey } from "../../../backend/workspaceKey";
import { useSessions } from "../../sessions/SessionContext";
import { useGitStatus } from "../../workspace/git/useGitStatus";
import { BranchPicker, type BranchPickerHandle } from "./BranchPicker";
import { useComposerWorkspace } from "./useComposerWorkspace";
import { useWorktreeSettings } from "./worktreeDefaults";
import { useGitRefs } from "./useGitRefs";
import { WorkspaceSelect, type WorkspaceSelectHandle } from "./WorkspaceSelect";
import { branchSelection, movedWorkspace } from "./workspaceLogic";
import "./branch-toolbar.css";

// Loaded when first opened, so the dialog stays out of the startup bundle.
const PullRequestDialog = lazy(() => import("./PullRequestDialog").then(module => ({ default: module.PullRequestDialog })));
/** The context strip under the composer, for projects that are Git repositories. */
export function BranchToolbar() {
  const state = useComposerWorkspace();
  if (!state.projectId || !state.key) return null;
  return <Toolbar state={state as ToolbarState} />;
}
type ToolbarState = ReturnType<typeof useComposerWorkspace> & { projectId: string; key: string };
const isMac = navigator.platform.toLowerCase().includes("mac");
function Toolbar({ state }: { state: ToolbarState }) {
  const { workspace, projectId, session } = state;
  const sessions = useSessions();
  const pending = workspace.mode === "worktree" && !workspace.worktreePath;
  // A new worktree lists the project's branches to start from; otherwise the branches of the folder the session uses.
  const status = useGitStatus(state.key).status;
  const refs = useGitRefs(pending ? workspaceKey(projectId) : state.key, status?.branch ?? null);
  const settings = useWorktreeSettings();
  const switchRef = useAtomSet(switchGitRef, { mode: "promise" });
  const create = useAtomSet(createSession, { mode: "promise" }), remove = useAtomSet(deleteSession, { mode: "promise" });
  const prepare = useAtomSet(preparePullRequest, { mode: "promise" });
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null), [pullRequest, setPullRequest] = useState<string | null>(null);
  const workspaceMenu = useRef<WorkspaceSelectHandle>(null), branchMenu = useRef<BranchPickerHandle>(null);
  const provider = status?.provider ?? null, hosted = provider?.kind === "github" || provider?.kind === "gitlab";
  const run = async (work: () => Promise<unknown>) => {
    setWorking(true); setError(null);
    try { await work(); } catch (failure) { setError(worktreeErrorMessage(failure)); } finally { setWorking(false); }
  };
  // Branch operations act through the session when there is one, so the backend records the branch it ends up on.
  const folderFor = (worktreePath: string | null) => session ? workspaceKey(projectId, session.sessionId) : worktreePath ? worktreeKey(projectId, worktreePath) : workspaceKey(projectId);
  function chooseWorkspace(choice: "local" | "worktree" | "previous") {
    if (choice === "local") { if (pending) void run(() => state.change(LOCAL_WORKSPACE)); return; }
    if (choice === "previous") { if (state.previous) void run(() => state.change(movedWorkspace(state.previous!.worktreePath, state.previous!.branch))); return; }
    if (pending) return;
    const startFromOrigin = settings ? projectSettings(settings, projectId).startFromOrigin : true;
    void run(() => state.change({ mode: "worktree", baseBranch: null, startFromOrigin, branch: null, worktreePath: null }));
  }
  function pick(ref: GitRef) {
    if (pending) { void run(() => state.change({ ...workspace, baseBranch: ref.name })); return; }
    const choice = branchSelection(workspace, state.projectPath, ref);
    void run(async () => {
      let next = workspace;
      if (choice.worktreePath !== workspace.worktreePath) { next = movedWorkspace(choice.worktreePath, ref.worktreePath ? ref.name : workspace.branch); await state.change(next); }
      if (!choice.checkout) return;
      const { branch } = await switchRef({ workspace: folderFor(next.worktreePath), ref: ref.name, create: false });
      if (state.draft) await state.change({ ...next, branch });
    });
  }
  function createBranch(name: string) {
    void run(async () => {
      const { branch } = await switchRef({ workspace: folderFor(workspace.worktreePath), ref: name, create: true });
      if (state.draft) await state.change({ ...workspace, branch });
    });
  }
  async function checkoutPullRequest(reference: string, mode: "local" | "worktree") {
    const location = { projectId, sessionId: crypto.randomUUID() };
    await create(location);
    try { await prepare({ ...location, reference, mode }); }
    catch (failure) { await remove({ ...location, revision: 0 }).catch(() => {}); throw failure; }
    setPullRequest(null);
    await sessions?.open(location);
  }
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(isMac ? event.metaKey : event.ctrlKey) || !event.shiftKey || event.altKey || event.defaultPrevented) return;
      if (document.activeElement?.closest(".terminal")) return;
      const action = event.code === "KeyX" ? () => workspaceMenu.current?.open() : event.code === "KeyG" ? () => branchMenu.current?.open()
        : event.code === "KeyL" && state.previous && !state.locked ? () => chooseWorkspace("previous") : null;
      if (!action) return;
      event.preventDefault(); action();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  if (refs.list && !refs.list.repository) return null;
  const busy = working || state.busy;
  return <div className="branch-toolbar" role="group" aria-label="Session workspace">
    <WorkspaceSelect ref={workspaceMenu} workspace={workspace} locked={state.locked} busy={busy} previous={state.previous} onChoose={chooseWorkspace} />
    <BranchPicker ref={branchMenu} workspace={workspace} refs={refs} busy={busy} pullRequestLabel={hosted ? changeRequestTerminology(provider.kind).singular : null}
      onQuery={refs.search} onPick={pick} onCreate={createBranch} onPullRequest={reference => setPullRequest(reference)}
      onStartFromOrigin={value => { void run(() => state.change({ ...workspace, startFromOrigin: value })); }} />
    {error && <p className="branch-toolbar__error" role="alert">{error}</p>}
    {pullRequest !== null && <Suspense fallback={null}><PullRequestDialog projectId={projectId} provider={provider} initial={pullRequest} onClose={() => setPullRequest(null)} onCheckout={checkoutPullRequest} /></Suspense>}
  </div>;
}
