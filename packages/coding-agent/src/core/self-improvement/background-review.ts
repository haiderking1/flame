/**
 * Post-turn self-improvement loop — the forked review agent.
 *
 * Ported from hermes-agent `agent/background_review.py`. After a qualifying
 * turn, the AgentSession fires this off the user-facing path. It constructs a
 * FRESH {@link Agent} that:
 *
 *  - reuses the parent's `streamFn` / `convertToLlm` / `model` / `sessionId`
 *    and base system prompt verbatim, so it inherits the parent's auth and hits
 *    the same provider prefix cache (hermes measured ~26% cost reduction from
 *    this parity);
 *  - is restricted to the memory + skill tools, sharing the parent's
 *    {@link MemoryStore} so `memory(...)` writes land on the same files on disk;
 *  - runs with no nudge tracker of its own, so it can never recurse into another
 *    review;
 *  - is capped at `maxIterations` assistant turns as a runaway backstop.
 *
 * It then walks the fork's transcript for successful memory/skill actions
 * (deduping against the inherited snapshot) and returns a compact summary line.
 *
 * Everything is best-effort: a failed review must never surface to the user or
 * disturb the main session.
 */
import {
	Agent,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/flame-agent-core";
import type { Message, Model, ThinkingBudgets, Transport } from "@earendil-works/flame-ai";
import type { MemoryStore } from "../memory/memory-store.ts";
import { createMemoryTool } from "../memory/memory-tool.ts";
import { createSkillManageToolDefinition } from "../skills/skill-manage-tool.ts";
import { createSkillViewToolDefinition } from "../skills/skill-view-tool.ts";
import { createSkillsListToolDefinition } from "../skills/skills-list-tool.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import { selectReviewPrompt } from "./review-prompts.ts";

/** Default iteration cap for the review fork (hermes uses 16). */
export const DEFAULT_REVIEW_MAX_ITERATIONS = 16;

export interface BackgroundReviewParams {
	/** Conversation snapshot to review (a copy of the parent transcript). */
	snapshot: AgentMessage[];
	/** Whether the memory gate fired. */
	reviewMemory: boolean;
	/** Whether the skill gate fired. */
	reviewSkills: boolean;
	/** Parent memory store, shared so writes hit the same files on disk. */
	memoryStore: MemoryStore;
	/** Parent model (inherited for auth + cache parity). */
	model: Model<any>;
	/** Parent thinking level. */
	thinkingLevel?: ThinkingLevel;
	/** Parent stream function (closes over auth resolution). */
	streamFn: StreamFn;
	/** Parent message converter (byte-identical conversion for cache parity). */
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	/** Parent transport preference. */
	transport?: Transport;
	/** Parent thinking budgets. */
	thinkingBudgets?: ThinkingBudgets;
	/** Parent retry-delay cap. */
	maxRetryDelayMs?: number;
	/** Parent session id (pins the provider prefix cache). */
	sessionId?: string;
	/** Parent base system prompt, reused verbatim for cache parity. */
	baseSystemPrompt: string;
	/** Assistant-turn cap. Default {@link DEFAULT_REVIEW_MAX_ITERATIONS}. */
	maxIterations?: number;
	/** Mirror the parent's `skill_manage` guard flag. */
	guardAgentCreated?: boolean;
	/** Session id forwarded to `skill_view` preprocessing. */
	skillViewSessionId?: string;
}

export interface BackgroundReviewResult {
	/** Compact `a · b` summary, or undefined when nothing was saved. */
	summary?: string;
	/** Raw action labels collected from the fork's transcript. */
	actions: string[];
}

/** Build the memory + skill tool whitelist for the review fork. */
function buildReviewTools(params: BackgroundReviewParams): AgentTool[] {
	return [
		createMemoryTool(params.memoryStore),
		wrapToolDefinition(createSkillsListToolDefinition()),
		wrapToolDefinition(createSkillViewToolDefinition({ sessionId: params.skillViewSessionId })),
		wrapToolDefinition(
			createSkillManageToolDefinition({ guardAgentCreated: params.guardAgentCreated, markCreatedAsAgent: true }),
		),
	];
}

/** Collect tool-call ids already present in the inherited snapshot. */
function snapshotToolCallIds(snapshot: AgentMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const msg of snapshot) {
		if (msg.role === "toolResult" && msg.toolCallId) {
			ids.add(msg.toolCallId);
		}
	}
	return ids;
}

/** Extract a `{ success, message, target }` shape from a tool-result message. */
function parseToolResult(msg: AgentMessage): { success: boolean; message: string; target: string } | undefined {
	if (msg.role !== "toolResult") {
		return undefined;
	}
	const textPart = msg.content.find((c): c is { type: "text"; text: string } => c.type === "text");
	if (!textPart) {
		return undefined;
	}
	try {
		const data = JSON.parse(textPart.text) as Record<string, unknown>;
		if (typeof data !== "object" || data === null) {
			return undefined;
		}
		return {
			success: data.success === true,
			message: typeof data.message === "string" ? data.message : "",
			target: typeof data.target === "string" ? data.target : "",
		};
	} catch {
		return undefined;
	}
}

/** Label for a memory write, mirroring hermes' summarize logic. */
function memoryLabel(target: string): string {
	if (target === "memory") return "Memory updated";
	if (target === "user") return "User profile updated";
	return target ? `${target} updated` : "Memory updated";
}

/**
 * Walk the review fork's transcript and collect human-facing action labels for
 * successful memory/skill writes, skipping tool results inherited from the
 * snapshot. Mirrors `summarize_background_review_actions`.
 */
export function summarizeReviewActions(reviewMessages: AgentMessage[], priorSnapshot: AgentMessage[]): string[] {
	const seenIds = snapshotToolCallIds(priorSnapshot);
	const actions: string[] = [];
	for (const msg of reviewMessages) {
		if (msg.role !== "toolResult") {
			continue;
		}
		if (msg.toolCallId && seenIds.has(msg.toolCallId)) {
			continue;
		}
		const parsed = parseToolResult(msg);
		if (!parsed || !parsed.success) {
			continue;
		}
		const message = parsed.message;
		const lower = message.toLowerCase();
		if (lower.includes("created") || lower.includes("updated")) {
			actions.push(message);
		} else if (
			lower.includes("added") ||
			lower.includes("entry added") ||
			lower.includes("removed") ||
			lower.includes("replaced")
		) {
			actions.push(memoryLabel(parsed.target));
		}
	}
	return actions;
}

/**
 * Run a background memory/skill review over the conversation snapshot.
 *
 * Resolves with the action summary. Never rejects: any failure resolves to an
 * empty result.
 */
export async function runBackgroundReview(params: BackgroundReviewParams): Promise<BackgroundReviewResult> {
	const maxIterations = Math.max(1, params.maxIterations ?? DEFAULT_REVIEW_MAX_ITERATIONS);

	try {
		const reviewAgent = new Agent({
			initialState: {
				systemPrompt: params.baseSystemPrompt,
				model: params.model,
				thinkingLevel: params.thinkingLevel ?? "off",
				tools: buildReviewTools(params),
			},
			convertToLlm: params.convertToLlm,
			streamFn: params.streamFn,
			transport: params.transport,
			thinkingBudgets: params.thinkingBudgets,
			maxRetryDelayMs: params.maxRetryDelayMs,
			sessionId: params.sessionId,
		});

		// Seed the fork with the parent conversation as history. The fork owns a
		// private copy — Agent.state.messages is assigned a sliced array.
		reviewAgent.state.messages = params.snapshot.slice();

		// Iteration backstop: count completed assistant turns and abort once the
		// cap is reached. The review prompt asks the model to act then stop, so
		// this rarely triggers; it only guards against a runaway loop.
		let turnCount = 0;
		const unsubscribe = reviewAgent.subscribe((event) => {
			if (event.type === "turn_end") {
				turnCount++;
				if (turnCount >= maxIterations) {
					reviewAgent.abort();
				}
			}
		});

		try {
			await reviewAgent.prompt(selectReviewPrompt(params.reviewMemory, params.reviewSkills));
		} finally {
			unsubscribe();
		}

		const actions = summarizeReviewActions(reviewAgent.state.messages, params.snapshot);
		// Dedupe while preserving order, like hermes' dict.fromkeys.
		const unique = [...new Set(actions)];
		return {
			summary: unique.length > 0 ? unique.join(" · ") : undefined,
			actions: unique,
		};
	} catch {
		// Best-effort: a broken review must never disturb the main session.
		return { actions: [] };
	}
}
