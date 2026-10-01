import type { GitOperation, GitPhase } from "../../../contracts/git.js";
import type { GitWriter } from "../writer/writer.js";
import type { HookEvents } from "./hooks.js";

/** Progress reporting for one durable operation; every call is persisted before the UI sees it. */
export interface ActionProgress {
  phase(phase: GitPhase, label: string): void;
  hooks: HookEvents;
  commit(sha: string): void;
}
export type ActionContext = { root: string; operation: GitOperation; signal: AbortSignal; progress: ActionProgress; writer: GitWriter };
