import { EventEmitter } from "node:events";
import type { SessionLocation } from "../../contracts/sessions.js";
import { WORKTREE_SETUP_STAGES, WORKTREE_SETUP_TAIL_LINES, type WorktreeSetupPhase, type WorktreeSetupSnapshot, type WorktreeSetupStage,
  type WorktreeSetupStageId, type WorktreeSetupStageStatus } from "../../contracts/worktree-setup.js";
import type { Sessions } from "../sessions/service.js";

const PROGRESS_SAVE_MS = 250;
const key = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
type Live = { run: SetupRun; timer?: ReturnType<typeof setTimeout> };

/** One worktree setup in progress: updates its snapshot, saves it to the session, and announces each change. */
export class SetupRun {
  private snapshot: WorktreeSetupSnapshot;
  // Aborted when the user chooses to work in the project checkout instead.
  readonly local = new AbortController();
  private cancellable = true;
  constructor(private readonly tracker: SetupTracker, readonly location: SessionLocation, turnId: string, base: Pick<WorktreeSetupSnapshot, "branch" | "baseRef" | "setupScript">) {
    const now = Date.now();
    this.snapshot = { turnId, phase: "running", startedAt: now, endedAt: null, ...base, worktreePath: null, error: null, sequence: now,
      stages: WORKTREE_SETUP_STAGES.map(id => ({ id, status: "pending", startedAt: null, endedAt: null, percent: null, detail: null, tail: [] })) };
  }
  get current() { return this.snapshot; }
  /** True until the agent has been handed the turn; afterwards the setup can no longer be abandoned. */
  get canWorkLocally() { return this.cancellable && this.snapshot.phase === "running"; }
  uncancellable() { this.cancellable = false; }
  stage(id: WorktreeSetupStageId, status: WorktreeSetupStageStatus, detail?: string | null) {
    const now = Date.now();
    this.patch(id, stage => ({ ...stage, status, detail: detail === undefined ? stage.detail : detail && clip(detail, 200),
      startedAt: status === "running" ? stage.startedAt ?? now : stage.startedAt, endedAt: status === "running" || status === "pending" ? null : now,
      percent: status === "done" && stage.percent !== null ? 100 : stage.percent }), true);
  }
  progress(id: WorktreeSetupStageId, percent: number | null, detail: string | null) {
    this.patch(id, stage => ({ ...stage, percent, detail: detail && clip(detail, 200) }), false);
  }
  line(id: WorktreeSetupStageId, line: string) {
    this.patch(id, stage => ({ ...stage, tail: [...stage.tail, clip(line, 400)].slice(-WORKTREE_SETUP_TAIL_LINES) }), false);
  }
  set(patch: Partial<Pick<WorktreeSetupSnapshot, "branch" | "baseRef" | "worktreePath" | "setupScript">>) { this.write({ ...this.snapshot, ...patch }, true); }
  finish(phase: Exclude<WorktreeSetupPhase, "running">, error: string | null = null) {
    const now = Date.now();
    // Whatever was still under way stops with the setup.
    const stages = this.snapshot.stages.map(stage => stage.status === "running" ? { ...stage, status: phase === "done" ? "done" as const : "failed" as const, endedAt: now }
      : stage.status === "pending" && phase !== "done" ? { ...stage, status: "skipped" as const } : stage);
    this.write({ ...this.snapshot, stages, phase, endedAt: now, error: error && clip(error, 1000) }, true);
    this.tracker.finished(this);
  }
  private patch(id: WorktreeSetupStageId, change: (stage: WorktreeSetupStage) => WorktreeSetupStage, save: boolean) {
    this.write({ ...this.snapshot, stages: this.snapshot.stages.map(stage => stage.id === id ? change(stage) : stage) }, save);
  }
  private write(next: WorktreeSetupSnapshot, save: boolean) {
    this.snapshot = { ...next, sequence: Math.max(Date.now(), this.snapshot.sequence + 1) };
    this.tracker.changed(this, save);
  }
}
/**
 * Live worktree setups, one per session. Every change is announced at once; stage changes are saved immediately and
 * progress at most a few times a second, so the card survives a reload and a restart can tell what was interrupted.
 */
export class SetupTracker extends EventEmitter {
  private readonly live = new Map<string, Live>();
  constructor(private readonly sessions: Pick<Sessions, "workspace">) { super(); this.setMaxListeners(0); }
  begin(location: SessionLocation, turnId: string, base: Pick<WorktreeSetupSnapshot, "branch" | "baseRef" | "setupScript">) {
    const previous = this.live.get(key(location));
    if (previous) { clearTimeout(previous.timer); previous.run.local.abort(); }
    const run = new SetupRun(this, location, turnId, base);
    this.live.set(key(location), { run });
    this.changed(run, true);
    return run;
  }
  find(location: SessionLocation) { return this.live.get(key(location))?.run ?? null; }
  snapshot(location: SessionLocation): WorktreeSetupSnapshot | null {
    return this.find(location)?.current ?? this.sessions.workspace(location, record => record.setup());
  }
  /** Shows a worktree's new branch name on the setup that created it, live or saved. */
  renamed(location: SessionLocation, worktreePath: string, branch: string) {
    const live = this.find(location);
    if (live) { if (live.current.worktreePath === worktreePath) live.set({ branch }); return; }
    this.sessions.workspace(location, record => {
      const saved = record.setup();
      if (saved?.worktreePath === worktreePath) record.saveSetup({ ...saved, branch, sequence: saved.sequence + 1 });
    });
    this.emit("change", key(location));
  }
  /** Forgets a session's last setup, once a later message makes its card irrelevant. */
  clear(location: SessionLocation) {
    if (this.live.has(key(location))) return;
    this.sessions.workspace(location, record => { if (record.setup()) record.saveSetup(null); });
    this.emit("change", key(location));
  }
  changed(run: SetupRun, save: boolean) {
    const entry = this.live.get(key(run.location));
    if (entry?.run === run) {
      if (save) { clearTimeout(entry.timer); entry.timer = undefined; this.save(run); }
      else entry.timer ??= setTimeout(() => { entry.timer = undefined; this.save(run); }, PROGRESS_SAVE_MS);
    }
    this.emit("change", key(run.location));
  }
  finished(run: SetupRun) {
    const entry = this.live.get(key(run.location));
    if (entry?.run !== run) return;
    clearTimeout(entry.timer);
    this.save(run);
    this.live.delete(key(run.location));
    this.emit("change", key(run.location));
  }
  private save(run: SetupRun) {
    // The live snapshot keeps the card current even when saving fails; a restart then reports the setup as interrupted.
    try { this.sessions.workspace(run.location, record => record.saveSetup(run.current)); } catch { /* Kept in memory. */ }
  }
  close() { for (const entry of this.live.values()) { clearTimeout(entry.timer); entry.run.local.abort(); } }
}
export const setupKey = key;
