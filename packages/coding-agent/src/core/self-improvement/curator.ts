/**
 * Inactivity curator — background skill-library maintenance.
 *
 * Ported from hermes-agent `agent/curator.py`. The curator is inactivity-
 * triggered (no daemon): when the session is idle and the last run was longer
 * than `intervalHours` ago, {@link maybeRunCurator} runs. It:
 *
 *  1. snapshots the skills tree (reversible safety net);
 *  2. applies deterministic age-based lifecycle transitions
 *     (active → stale → archived) anchored on each skill's latest real activity
 *     from the `.usage.json` sidecar (see `../skills/skill-usage.ts`), falling
 *     back to `created_at`. Only agent-created skills are touched; pinned skills
 *     are never touched. Archiving moves the directory into `<skills>/.archive/`
 *     and never deletes;
 *  3. optionally runs an LLM consolidation pass (umbrella-building) via a forked
 *     headless agent restricted to the skill tools.
 *
 * Strict invariants, matching hermes: never auto-deletes (archive only),
 * pinned skills bypass all transitions, and the deterministic pass needs no
 * model. Best-effort throughout — a curator failure never disturbs the session.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import { agentCreatedReport, archiveSkill, setState as usageSetState } from "../skills/skill-usage.ts";
import { createSkillViewToolDefinition } from "../skills/skill-view-tool.ts";
import { createSkillsListToolDefinition } from "../skills/skills-list-tool.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import {
	buildRenameSummary,
	type CapturedSkillCall,
	type ClassificationResult,
	reconcileRemovedSkills,
} from "./consolidation-reconcile.ts";
import { snapshotSkills } from "./curator-backup.ts";
import { buildCuratorReviewPrompt } from "./curator-prompts.ts";
import { type CuratorState, loadCuratorState, type SkillLifecycleState, saveCuratorState } from "./curator-state.ts";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface CuratorSettings {
	enabled: boolean;
	intervalHours: number;
	/** Minimum hours of agent inactivity before a run is allowed. */
	minIdleHours: number;
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

export interface SkillTransitionDetail {
	name: string;
	from: SkillLifecycleState;
	to: SkillLifecycleState;
}

/**
 * Apply deterministic, LLM-free lifecycle transitions. Faithful port of hermes'
 * `apply_automatic_transitions`: walk every agent-created skill, anchor on its
 * latest real activity (`last_activity_at`, falling back to `created_at`), and
 * move active → stale → archived. Pinned skills are never touched. State and
 * archival are persisted in the `.usage.json` sidecar (skill-usage), not here.
 * In `dryRun` mode nothing is written — counts and details only.
 */
export async function applyAutomaticTransitions(
	settings: CuratorSettings,
	now: number = Date.now(),
	dryRun = false,
	details?: SkillTransitionDetail[],
): Promise<TransitionCounts> {
	const staleCutoff = now - settings.staleAfterDays * MS_PER_DAY;
	const archiveCutoff = now - settings.archiveAfterDays * MS_PER_DAY;
	const counts: TransitionCounts = { checked: 0, markedStale: 0, archived: 0, reactivated: 0 };

	for (const row of agentCreatedReport()) {
		counts.checked++;
		if (row.pinned) {
			continue;
		}
		// Never-active skills anchor on created_at so they don't archive immediately.
		const anchor = parseIsoMs(row.last_activity_at) ?? parseIsoMs(row.created_at) ?? now;
		const current = (row.state ?? "active") as SkillLifecycleState;
		if (current === "archived") {
			continue;
		}

		if (anchor <= archiveCutoff) {
			let ok = true;
			if (!dryRun) {
				ok = (await archiveSkill(row.name)).ok;
			}
			if (ok) {
				counts.archived++;
				details?.push({ name: row.name, from: current, to: "archived" });
			}
		} else if (anchor <= staleCutoff && current === "active") {
			if (!dryRun) {
				await usageSetState(row.name, "stale");
			}
			counts.markedStale++;
			details?.push({ name: row.name, from: current, to: "stale" });
		} else if (anchor > staleCutoff && current === "stale") {
			if (!dryRun) {
				await usageSetState(row.name, "active");
			}
			counts.reactivated++;
			details?.push({ name: row.name, from: current, to: "active" });
		}
	}

	return counts;
}

/** Parse an ISO timestamp to epoch-ms, or undefined when absent/invalid. */
function parseIsoMs(value: string | null | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
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
	/** Force run bypassing deterministic schedule gates. */
	force?: boolean;
	/** Run in dry-run mode (simulation only, no disk writes or snapshots). */
	dryRun?: boolean;
	/**
	 * Seconds the agent has been idle since its last activity. When provided, a
	 * run is skipped unless idle ≥ `minIdleHours` — matching hermes' idle gate
	 * so the curator never competes with active work. Undefined skips the gate.
	 */
	idleForSeconds?: number;
}

/**
 * Run the curator if the gates allow it. Returns `{ ran: false }` when skipped.
 * Best-effort: never throws.
 */
export async function maybeRunCurator(params: MaybeRunCuratorParams): Promise<CuratorRunResult> {
	const now = params.now ?? Date.now();
	const state = loadCuratorState();
	const dryRun = params.dryRun === true;

	if (!params.force && !shouldRunNow(state, params.settings, now)) {
		// Seed lastRunAt on first observation so the first real pass is deferred.
		if (params.settings.enabled && !state.paused && !state.lastRunAt) {
			state.lastRunAt = new Date(now).toISOString();
			state.lastRunSummary = "deferred first run — curator seeded";
			await saveCuratorState(state);
		}
		return { ran: false };
	}

	// Idle gate (hermes parity): only enforce when the caller measured idle time,
	// and never for forced/manual runs. Defers when the agent was recently active.
	if (!params.force && params.idleForSeconds !== undefined) {
		if (params.idleForSeconds < params.settings.minIdleHours * 3600) {
			return { ran: false };
		}
	}

	try {
		// 1. Snapshot before any mutation (only in live mode).
		if (!dryRun) {
			snapshotSkills("pre-curator-run", params.settings.maxBackups);
		}

		// 2. Deterministic transitions.
		const transitionDetails: SkillTransitionDetail[] = [];
		const counts = await applyAutomaticTransitions(params.settings, now, dryRun, transitionDetails);
		const pinnedNames = agentCreatedReport()
			.filter((r) => r.pinned)
			.map((r) => r.name);

		// 3. Optional LLM consolidation pass (only in live mode).
		let consolidation: ConsolidationOutcome | undefined;
		if (!dryRun && params.settings.llmConsolidation && canRunConsolidation(params)) {
			consolidation = await runCuratorConsolidation(params);
		}
		const consolidatedCount = consolidation?.classification.consolidated.length ?? 0;
		const prunedCount = consolidation?.classification.pruned.length ?? 0;

		const summaryParts: string[] = [];
		if (counts.markedStale) summaryParts.push(`${counts.markedStale} stale`);
		if (counts.archived) summaryParts.push(`${counts.archived} archived`);
		if (counts.reactivated) summaryParts.push(`${counts.reactivated} reactivated`);
		if (consolidatedCount) summaryParts.push(`${consolidatedCount} consolidated`);
		if (prunedCount) summaryParts.push(`${prunedCount} pruned`);
		else if (consolidation) summaryParts.push("consolidation pass complete");
		let summary = summaryParts.length > 0 ? summaryParts.join(", ") : "no changes";
		if (dryRun) {
			summary = `dry-run: ${summary}`;
		}

		if (!dryRun) {
			state.lastRunAt = new Date(now).toISOString();
			state.lastRunSummary = summary;
			state.runCount += 1;
			await saveCuratorState(state);
		}

		// 4. Write run reports (REPORT.md + run.json) to runs log directory.
		try {
			const d = new Date(now);
			const pad = (n: number) => String(n).padStart(2, "0");
			const runId = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
			const runDir = join(getSkillsDir(), ".curator_runs", runId);
			mkdirSync(runDir, { recursive: true });

			const runJson = {
				runId,
				timestamp: d.toISOString(),
				dryRun,
				settings: params.settings,
				counts,
				transitions: transitionDetails,
				pinned: pinnedNames,
				consolidation: consolidation
					? {
							consolidated: consolidation.classification.consolidated,
							pruned: consolidation.classification.pruned,
							finalText: consolidation.text,
						}
					: undefined,
			};
			writeFileSync(join(runDir, "run.json"), `${JSON.stringify(runJson, null, 2)}\n`, "utf-8");

			let report = `# Curator Run Report — ${d.toISOString()}\n\n`;
			if (dryRun) {
				report += `> [!WARNING]\n`;
				report += `> **DRY RUN PASS ONLY** — No files were modified, consolidated, or archived.\n\n`;
			}
			report += `## Summary\n\n`;
			report += `- **Date/Time**: ${d.toISOString()}\n`;
			report += `- **Mode**: ${dryRun ? "Dry-run (simulation)" : "Live (mutating)"}\n`;
			report += `- **Total Checked**: ${counts.checked}\n`;
			report += `- **Marked Stale**: ${counts.markedStale}\n`;
			report += `- **Archived**: ${counts.archived}\n`;
			report += `- **Reactivated**: ${counts.reactivated}\n\n`;

			if (transitionDetails.length > 0) {
				report += `## Transitions\n\n`;
				report += `| Skill | Action | From State | To State |\n`;
				report += `| :--- | :--- | :--- | :--- |\n`;
				for (const t of transitionDetails) {
					const actionText =
						t.to === "archived"
							? "Archived (moved to .archive)"
							: t.to === "stale"
								? "Marked Stale"
								: "Reactivated Active";
					report += `| \`${t.name}\` | ${actionText} | \`${t.from}\` | \`${t.to}\` |\n`;
				}
				report += `\n`;
			} else {
				report += `## Transitions\n\nNo skill transitions occurred during this pass.\n\n`;
			}

			if (pinnedNames.length > 0) {
				report += `## Pinned Skills (Bypassed)\n\n`;
				for (const p of pinnedNames) {
					report += `- \`${p}\`\n`;
				}
				report += `\n`;
			}

			if (consolidation) {
				report += `## LLM Consolidation Results\n\n`;
				const { consolidated, pruned } = consolidation.classification;
				if (consolidated.length > 0) {
					report += `### Consolidated (absorbed into an umbrella)\n\n`;
					report += `| Skill | Into | Evidence |\n| :--- | :--- | :--- |\n`;
					for (const e of consolidated) {
						report += `| \`${e.name}\` | \`${e.into}\` | ${e.evidence ?? ""} |\n`;
					}
					report += `\n`;
				}
				if (pruned.length > 0) {
					report += `### Pruned (archived, no forwarding target)\n\n`;
					for (const e of pruned) {
						report += `- \`${e.name}\`\n`;
					}
					report += `\n`;
				}
				if (consolidation.renameSummary) {
					report += `\`\`\`\n${consolidation.renameSummary}\n\`\`\`\n\n`;
				}
				if (consolidation.text) {
					report += `${consolidation.text}\n`;
				}
			}

			writeFileSync(join(runDir, "REPORT.md"), report, "utf-8");
		} catch {
			// Best-effort reporting — never crash curator loop due to logging failure.
		}

		return { ran: true, counts, consolidationSummary: consolidation?.text, summary };
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
		wrapToolDefinition(
			createSkillManageToolDefinition({ guardAgentCreated: params.guardAgentCreated, markCreatedAsAgent: true }),
		),
	];
}

/** Outcome of the LLM consolidation pass: final text + removed-skill classification. */
export interface ConsolidationOutcome {
	text?: string;
	classification: ClassificationResult;
	renameSummary: string;
}

/** Distinct skill names currently on disk (excluding the archive tree). */
function currentSkillNames(): Set<string> {
	const names = new Set<string>();
	for (const skill of discoverAllSkills()) {
		if (!skill.filePath.split("\\").join("/").includes("/.archive/")) {
			names.add(skill.name);
		}
	}
	return names;
}

/** Run the forked LLM consolidation pass + reconcile what it removed. */
async function runCuratorConsolidation(params: MaybeRunCuratorParams): Promise<ConsolidationOutcome | undefined> {
	const maxIterations = Math.max(1, params.maxIterations ?? 24);
	try {
		const beforeNames = currentSkillNames();
		const calls: CapturedSkillCall[] = [];

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
			if (event.type === "tool_execution_start" && event.toolName === "skill_manage") {
				calls.push((event.args ?? {}) as CapturedSkillCall);
			} else if (event.type === "turn_end") {
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

		const afterNames = currentSkillNames();
		const removed = [...beforeNames].filter((n) => !afterNames.has(n)).sort();
		const added = [...afterNames].filter((n) => !beforeNames.has(n)).sort();
		const classification = reconcileRemovedSkills(removed, added, afterNames, calls);

		return {
			text: lastAssistantText(agent.state.messages),
			classification,
			renameSummary: buildRenameSummary(classification),
		};
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
