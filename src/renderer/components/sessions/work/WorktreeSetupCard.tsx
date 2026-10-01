import { useEffect, useId, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import { worktreeSetupStageLabel, type WorktreeSetupSnapshot, type WorktreeSetupStage } from "@contracts/worktree-setup";
import { workLocally, worktreeErrorMessage } from "../../../backend/worktrees";
import { WorkspaceIcon, type WorkspaceIconName } from "../../workspace/WorkspaceIcon";
import { agentStarted } from "../../composer/workspace/workspaceLogic";
import "../../workspace/git/git-dialogs.css";
import "./worktree-setup-card.css";

const icon: Record<WorktreeSetupStage["status"], WorkspaceIconName> = { pending: "circle-alert", running: "loader", done: "circle-check", skipped: "chevron-right", warning: "circle-alert", failed: "circle-alert" };
function heading(snapshot: WorktreeSetupSnapshot) {
  if (snapshot.phase === "running") return "Setting up worktree…";
  if (snapshot.phase === "failed") return "Worktree setup failed";
  if (snapshot.phase === "cancelled") return "Worktree setup cancelled";
  return snapshot.stages.some(stage => stage.id === "setup-script" && stage.status === "failed") ? "Worktree ready, setup script failed" : "Worktree ready";
}
function elapsed(stage: WorktreeSetupStage, now: number) {
  if (stage.startedAt === null || stage.status === "skipped") return null;
  const seconds = Math.max(0, Math.round(((stage.endedAt ?? now) - stage.startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
/**
 * T3 Code's worktree setup card: each stage of creating the session's worktree with its progress and time, the setup
 * script's output, and, until the agent takes over, Cancel or "Work locally" to use the project checkout instead.
 */
export default function WorktreeSetupCard({ location, snapshot, onCancel }: { location: SessionLocation; snapshot: WorktreeSetupSnapshot; onCancel(): void }) {
  const local = useAtomSet(workLocally, { mode: "promise" });
  const [details, setDetails] = useState(false), [error, setError] = useState<string | null>(null), [now, setNow] = useState(Date.now);
  const detailsId = useId();
  const running = snapshot?.phase === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const script = snapshot.stages.find(stage => stage.id === "setup-script")!;
  const interruptible = running && !agentStarted(snapshot) && !snapshot.stages.some(stage => stage.id === "agent" && stage.status === "running");
  return <section className="worktree-setup" aria-label="Worktree setup" data-phase={snapshot.phase}>
    <header className="worktree-setup__header">
      <WorkspaceIcon name={running ? "loader" : snapshot.phase === "done" ? "folder-git-2" : "circle-alert"} className={running ? "worktree-setup__spin" : undefined} />
      <h3>{heading(snapshot)}</h3>
      {snapshot.branch && <span className="worktree-setup__branch" title={snapshot.worktreePath ?? undefined}>{snapshot.branch}</span>}
    </header>
    <ol className="worktree-setup__stages">
      {snapshot.stages.map(stage => <li key={stage.id} data-status={stage.status}>
        <WorkspaceIcon name={icon[stage.status]} className={stage.status === "running" ? "worktree-setup__spin" : undefined} />
        <span className="worktree-setup__label">{stage.id === "setup-script" && snapshot.setupScript ? snapshot.setupScript.name : worktreeSetupStageLabel(stage.id)}</span>
        {stage.id === "checkout" && stage.status === "running" && stage.percent !== null && <span className="worktree-setup__percent">{stage.percent}%</span>}
        {stage.detail && <span className="worktree-setup__detail" title={stage.detail}>{stage.detail}</span>}
        <span className="worktree-setup__time">{elapsed(stage, now)}</span>
      </li>)}
    </ol>
    {snapshot.error && <p className="worktree-setup__error" role="alert">{snapshot.error}</p>}
    {error && <p className="worktree-setup__error" role="alert">{error}</p>}
    {details && <pre id={detailsId} className="worktree-setup__output flame-scrollbar">{script.tail.length ? script.tail.join("\n") : "No output yet."}</pre>}
    {!details && script.status === "running" && script.tail.length > 0 && <pre className="worktree-setup__output worktree-setup__output--tail">{script.tail.slice(-4).join("\n")}</pre>}
    <footer className="worktree-setup__actions">
      {snapshot.setupScript && <button type="button" className="git-button git-button--ghost git-button--xs" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(value => !value)}>Details</button>}
      {interruptible && <button type="button" className="git-button git-button--outline git-button--xs" onClick={() => {
        setError(null);
        local(location).then(done => { if (!done) setError("The worktree is ready and the agent has started; it can no longer be switched."); }, failure => setError(worktreeErrorMessage(failure)));
      }}>Work locally</button>}
      {interruptible && <button type="button" className="git-button git-button--outline git-button--xs" onClick={onCancel}>Cancel</button>}
    </footer>
  </section>;
}
