/**
 * Inactivity curator — background skill-library maintenance.
 *
 * Ported from hermes-agent `agent/curator.py`. The curator is inactivity-
 * triggered (no daemon): when the session is idle and the last run was longer
 * than `intervalHours` ago, {@link maybeRunCurator} runs. It:
 *
 *  1. snapshots the skills tree (reversible safety net);
 *  2. applies deterministic age-based lifecycle transitions
 *     (active → stale → archived) using each skill directory's most recent file
 *     mtime as the activity anchor — flame's filesystem-native substitute for
 *     hermes' usage DB. Pinned skills are never touched. Archiving moves the
 *     directory into `<skills>/.archive/` and never deletes;
 *  3. optionally runs an LLM consolidation pass (umbrella-building) via a forked
 *     headless agent restricted to the skill tools.
 *
 * Strict invariants, matching hermes: never auto-deletes (archive only),
 * pinned skills bypass all transitions, and the deterministic pass needs no
 * model. Best-effort throughout — a curator failure never disturbs the session.
 */
import { type Dirent, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	Agent,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/flame-agent-core";
import type { Message, Model, ThinkingBudgets, Transport } from "@earendil-works/flame-ai";
import { discoverAllSkills } from "../skills/discovery.ts";
import { getSkillsDir } from "../skills/paths.ts";
import { createSkillManageToolDefinition } from "../skills/skill-manage-tool.ts";
import { createSkillViewToolDefinition } from "../skills/skill-view-tool.ts";
import { createSkillsListToolDefinition } from "../skills/skills-list-tool.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import { snapshotSkills } from "./curator-backup.ts";
import { buildCuratorReviewPrompt } from "./curator-prompts.ts";
import { type CuratorState, loadCuratorState, saveCuratorState } from "./curator-state.ts";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface CuratorSettings {
	enabled: boolean;
	intervalHours: number;
	staleAfterDays: number;
	archiveAfterDays: number;
	maxBackups: number;
	llmConsolidation: boolean;
}

export interface TransitionCounts {
	checked: number;
	markedStale: number;
	archived: number;
	reactivated: number;
}

export interface CuratorRunResult {
	ran: boolean;
	counts?: TransitionCounts;
	consolidationSummary?: string;
	summary?: string;
}

interface SkillEntry {
	name: string;
	skillDir: string;
}

/** Enumerate agent-authored skills, excluding the archive tree. */
function enumerateSkills(): SkillEntry[] {
	const skills = discoverAllSkills();
	const entries: SkillEntry[] = [];
	for (const skill of skills) {
		const normalized = skill.filePath.split("\\").join("/");
		if (normalized.includes("/.archive/")) {
			continue;
		}
		entries.push({ name: skill.name, skillDir: dirname(skill.filePath) });
	}
	return entries;
}

/** Most recent file mtime under a skill directory (the activity anchor). */
function skillActivityMs(skillDir: string): number {
	let newest = 0;
	const walk = (dir: string): void => {
		let dirEntries: Dirent[];
		try {
			dirEntries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of dirEntries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			try {
				const mtime = statSync(full).mtimeMs;
				if (mtime > newest) {
					newest = mtime;
				}
			} catch {
				// ignore unreadable file
			}
		}
	};
	walk(skillDir);
	if (newest === 0) {
		try {
			newest = statSync(skillDir).mtimeMs;
		} catch {
			newest = Date.now();
		}
	}
	return newest;
}

/** Move a skill directory into `<skills>/.archive/<name>/`. Never deletes. */
function archiveSkillDir(name: string, skillDir: string): boolean {
	const archiveRoot = join(getSkillsDir(), ".archive");
	try {
		mkdirSync(archiveRoot, { recursive: true });
		let dest = join(archiveRoot, name);
		let suffix = 1;
		while (existsSync(dest)) {
			dest = join(archiveRoot, `${name}-${suffix++}`);
		}
		renameSync(skillDir, dest);
		return true;
	} catch {
		return false;
	}
}

/**
 * Apply deterministic, LLM-free lifecycle transitions. Mirrors hermes'
 * `apply_automatic_transitions`. Mutates `state.states` in place.
 */
export function applyAutomaticTransitions(
	state: CuratorState,
	settings: CuratorSettings,
	now: number = Date.now(),
): TransitionCounts {
	const staleCutoff = now - settings.staleAfterDays * MS_PER_DAY;
	const archiveCutoff = now - settings.archiveAfterDays * MS_PER_DAY;
	const counts: TransitionCounts = { checked: 0, markedStale: 0, archived: 0, reactivated: 0 };
	const pinned = new Set(state.pinned);

	for (const { name, skillDir } of enumerateSkills()) {
		counts.checked++;
		if (pinned.has(name)) {
			continue;
		}
		const anchor = skillActivityMs(skillDir);
		const current = state.states[name] ?? "active";
		if (current === "archived") {
			continue;
		}

		if (anchor <= archiveCutoff) {
			if (archiveSkillDir(name, skillDir)) {
				state.states[name] = "archived";
				counts.archived++;
			}
		} else if (anchor <= staleCutoff && current === "active") {
			state.states[name] = "stale";
			counts.markedStale++;
		} else if (anchor > staleCutoff && current === "stale") {
			state.states[name] = "active";
			counts.reactivated++;
		}
	}

	return counts;
}

/** Static run gates: enabled, not paused, and one interval since the last run. */
export function shouldRunNow(state: CuratorState, settings: CuratorSettings, now: number = Date.now()): boolean {
	if (!settings.enabled || state.paused) {
		return false;
	}
	if (!state.lastRunAt) {
		// First observation: seed and defer one interval (matches hermes).
		return false;
	}
	const last = Date.parse(state.lastRunAt);
	if (Number.isNaN(last)) {
		return false;
	}
	return now - last >= settings.intervalHours * MS_PER_HOUR;
}

export interface MaybeRunCuratorParams {
	settings: CuratorSettings;
	/** Runtime for the optional LLM consolidation fork (inherited from the parent). */
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	streamFn?: StreamFn;
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	transport?: Transport;
	thinkingBudgets?: ThinkingBudgets;
	maxRetryDelayMs?: number;
	sessionId?: string;
	baseSystemPrompt?: string;
	guardAgentCreated?: boolean;
	/** Cap on the consolidation fork's assistant turns (default 24). */
	maxIterations?: number;
	/** Override the clock (tests). */
	now?: number;
}

/**
 * Run the curator if the gates allow it. Returns `{ ran: false }` when skipped.
 * Best-effort: never throws.
 */
export async function maybeRunCurator(params: MaybeRunCuratorParams): Promise<CuratorRunResult> {
	const now = params.now ?? Date.now();
	const state = loadCuratorState();

	if (!shouldRunNow(state, params.settings, now)) {
		// Seed lastRunAt on first observation so the first real pass is deferred.
		if (params.settings.enabled && !state.paused && !state.lastRunAt) {
			state.lastRunAt = new Date(now).toISOString();
			state.lastRunSummary = "deferred first run — curator seeded";
			await saveCuratorState(state);
		}
		return { ran: false };
	}

	try {
		// 1. Snapshot before any mutation.
		snapshotSkills("pre-curator-run", params.settings.maxBackups);

		// 2. Deterministic transitions.
		const counts = applyAutomaticTransitions(state, params.settings, now);

		// 3. Optional LLM consolidation pass.
		let consolidationSummary: string | undefined;
		if (params.settings.llmConsolidation && canRunConsolidation(params)) {
			consolidationSummary = await runCuratorConsolidation(params);
		}

		const summaryParts: string[] = [];
		if (counts.markedStale) summaryParts.push(`${counts.markedStale} stale`);
		if (counts.archived) summaryParts.push(`${counts.archived} archived`);
		if (counts.reactivated) summaryParts.push(`${counts.reactivated} reactivated`);
		if (consolidationSummary) summaryParts.push("consolidation pass complete");
		const summary = summaryParts.length > 0 ? summaryParts.join(", ") : "no changes";

		state.lastRunAt = new Date(now).toISOString();
		state.lastRunSummary = summary;
		state.runCount += 1;
		await saveCuratorState(state);

		return { ran: true, counts, consolidationSummary, summary };
	} catch {
		return { ran: false };
	}
}

function canRunConsolidation(params: MaybeRunCuratorParams): boolean {
	return Boolean(params.model && params.streamFn && params.convertToLlm && params.baseSystemPrompt !== undefined);
}

/** Skill-only tool whitelist for the consolidation fork. */
function buildCuratorTools(params: MaybeRunCuratorParams): AgentTool[] {
	return [
		wrapToolDefinition(createSkillsListToolDefinition()),
		wrapToolDefinition(createSkillViewToolDefinition({ sessionId: params.sessionId })),
		wrapToolDefinition(createSkillManageToolDefinition({ guardAgentCreated: params.guardAgentCreated })),
	];
}

/** Run the forked LLM consolidation pass. Returns its final text, or undefined. */
async function runCuratorConsolidation(params: MaybeRunCuratorParams): Promise<string | undefined> {
	const maxIterations = Math.max(1, params.maxIterations ?? 24);
	try {
		const agent = new Agent({
			initialState: {
				systemPrompt: params.baseSystemPrompt ?? "",
				model: params.model as Model<any>,
				thinkingLevel: params.thinkingLevel ?? "off",
				tools: buildCuratorTools(params),
			},
			convertToLlm: params.convertToLlm,
			streamFn: params.streamFn as StreamFn,
			transport: params.transport,
			thinkingBudgets: params.thinkingBudgets,
			maxRetryDelayMs: params.maxRetryDelayMs,
			sessionId: params.sessionId,
		});

		let turnCount = 0;
		const unsubscribe = agent.subscribe((event) => {
			if (event.type === "turn_end") {
				turnCount++;
				if (turnCount >= maxIterations) {
					agent.abort();
				}
			}
		});

		try {
			await agent.prompt(buildCuratorReviewPrompt());
		} finally {
			unsubscribe();
		}

		return lastAssistantText(agent.state.messages);
	} catch {
		return undefined;
	}
}

function lastAssistantText(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const text = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("")
				.trim();
			return text.length > 0 ? text : undefined;
		}
	}
	return undefined;
}
