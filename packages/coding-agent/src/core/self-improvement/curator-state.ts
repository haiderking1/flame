/**
 * Persistent curator scheduler state — `<skills>/.curator_state`.
 *
 * Ported from hermes-agent `agent/curator.py`. Holds only run-level metadata
 * (last run time, summary, count, pause flag). Per-skill lifecycle state, pins,
 * and provenance live in the `.usage.json` sidecar (see `../skills/skill-usage.ts`),
 * exactly as hermes keeps them in its `skill_usage` store.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "../memory/atomic-write.ts";
import { getSkillsDir } from "../skills/paths.ts";

export type SkillLifecycleState = "active" | "stale" | "archived";

export interface CuratorState {
	/** ISO timestamp of the last curator run, or null if never run. */
	lastRunAt: string | null;
	/** Human-facing summary of the last run. */
	lastRunSummary: string | null;
	/** When true, the curator is disabled regardless of settings. */
	paused: boolean;
	/** Total number of completed runs. */
	runCount: number;
}

export function defaultCuratorState(): CuratorState {
	return {
		lastRunAt: null,
		lastRunSummary: null,
		paused: false,
		runCount: 0,
	};
}

function stateFilePath(): string {
	return join(getSkillsDir(), ".curator_state");
}

export function loadCuratorState(): CuratorState {
	const path = stateFilePath();
	if (!existsSync(path)) {
		return defaultCuratorState();
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<CuratorState>;
		if (typeof raw !== "object" || raw === null) {
			return defaultCuratorState();
		}
		const base = defaultCuratorState();
		return {
			lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : base.lastRunAt,
			lastRunSummary: typeof raw.lastRunSummary === "string" ? raw.lastRunSummary : base.lastRunSummary,
			paused: typeof raw.paused === "boolean" ? raw.paused : base.paused,
			runCount: typeof raw.runCount === "number" ? raw.runCount : base.runCount,
		};
	} catch {
		return defaultCuratorState();
	}
}

export async function saveCuratorState(state: CuratorState): Promise<void> {
	try {
		await atomicWrite(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`);
	} catch {
		// Best-effort persistence — never crash the session over curator state.
	}
}

export async function setCuratorPaused(paused: boolean): Promise<void> {
	const state = loadCuratorState();
	state.paused = paused;
	await saveCuratorState(state);
}
