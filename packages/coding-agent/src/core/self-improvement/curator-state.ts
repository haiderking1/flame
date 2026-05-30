/**
 * Persistent curator state — `<skills>/.curator_state`.
 *
 * Ported from hermes-agent `agent/curator.py` (the `.curator_state` file) plus
 * the lifecycle-state and pin tracking that hermes keeps in its `skill_usage`
 * DB. Flame has no usage database, so per-skill lifecycle state and pins live
 * here alongside the scheduler fields.
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
	/** Skill names the user pinned — exempt from all auto-transitions. */
	pinned: string[];
	/** Per-skill lifecycle state, keyed by skill name. */
	states: Record<string, SkillLifecycleState>;
}

export function defaultCuratorState(): CuratorState {
	return {
		lastRunAt: null,
		lastRunSummary: null,
		paused: false,
		runCount: 0,
		pinned: [],
		states: {},
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
			pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((n): n is string => typeof n === "string") : base.pinned,
			states: isStateMap(raw.states) ? raw.states : base.states,
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

export async function pinSkill(name: string): Promise<void> {
	const state = loadCuratorState();
	if (!state.pinned.includes(name)) {
		state.pinned.push(name);
		await saveCuratorState(state);
	}
}

export async function unpinSkill(name: string): Promise<void> {
	const state = loadCuratorState();
	const next = state.pinned.filter((n) => n !== name);
	if (next.length !== state.pinned.length) {
		state.pinned = next;
		await saveCuratorState(state);
	}
}

function isStateMap(value: unknown): value is Record<string, SkillLifecycleState> {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	for (const v of Object.values(value)) {
		if (v !== "active" && v !== "stale" && v !== "archived") {
			return false;
		}
	}
	return true;
}
