/**
 * Agent swarm — spawn many isolated sub-agents in parallel from one tool call.
 *
 * The main agent calls `agent_swarm` with a list of tasks (or a single `goal`
 * to auto-decompose). Each task spins up a FRESH {@link Agent} that:
 *
 *  - reuses the parent's `streamFn` / `convertToLlm` / `model` / `sessionId` and
 *    base system prompt verbatim, so every worker inherits the parent's auth and
 *    hits the same provider prefix cache (same parity trick the background-review
 *    fork uses in `background-review.ts`);
 *  - gets its own scoped coding toolset (read/grep/find/ls/bash/write/edit/
 *    web_search by default) so it can actually do work in the cwd;
 *  - runs to completion on its single task prompt with no memory of the others,
 *    with no turn cap by default (like the main agent) — pass `max_turns_per_agent`
 *    to impose a runaway backstop.
 *
 * Workers run through a bounded concurrency pool (default 8, up to `maxWorkers`)
 * so the model can request "100 agents" without opening 100 simultaneous
 * provider connections. Every worker and the verifier/judge/planner run on the
 * parent's inherited model — the swarm is about parallelism, not model routing.
 *
 * Force-multipliers layered on top (all opt-in):
 *  - **Planner** — give a `goal` instead of tasks and a planner agent decomposes
 *    it into independent parallel subtasks first (and can wire `depends_on` edges).
 *  - **Dependency DAG** — a task's `depends_on` lists other task ids that must
 *    finish first; the dependent then starts with their outputs injected into its
 *    prompt, so pipelines (backend after frontend) build on real results instead
 *    of guessing. A task whose dependency failed is skipped (cascading).
 *  - **Consensus** — `consensus_samples` runs the same task N times and a judge
 *    picks the best answer (self-consistency; makes weak models reliable).
 *  - **Recursive swarms** — each worker is handed an `agent_swarm` tool until
 *    `maxDepth`, so it can fan its own subtask out further (fork-bomb capped).
 *  - **Verifier** — `verify` spawns a checker that cross-checks the merged output
 *    against the codebase.
 *  - **Blackboard** — `blackboard` gives workers a shared `swarm_note` tool to
 *    post and read each other's findings.
 *  - **Worktree isolation** — `isolate: "worktree"` runs each worker in its own
 *    git worktree/branch so parallel edits never collide.
 *  - **Quorum / budget / retry** — stop once N succeed, cap total turns, and
 *    auto-retry flaky workers.
 *  - **Transcripts** — `save_transcripts` dumps each worker's full transcript.
 *
 * The fork context (streamFn/model/…) is not available at tool-construction
 * time, so the owning AgentSession passes a lazy `getForkContext()` that reads
 * the live `this.agent` when a swarm is actually launched.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	Agent,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/flame-agent-core";
import type { Message, Model, TextContent, ThinkingBudgets, Transport } from "@earendil-works/flame-ai";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { createBashTool } from "./bash.ts";
import { createEditTool } from "./edit.ts";
import { createFindTool } from "./find.ts";
import { createGrepTool } from "./grep.ts";
import { createLsTool } from "./ls.ts";
import { createReadTool } from "./read.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { createWebSearchTool } from "./web-search.ts";
import { createWriteTool } from "./write.ts";

/** Default number of workers allowed to run at once. */
export const DEFAULT_SWARM_CONCURRENCY = 8;
/** Hard cap on workers per call, to bound resource use. */
export const DEFAULT_SWARM_MAX_WORKERS = 100;
/** Default nesting cap: how many levels of recursive sub-swarms are allowed. */
export const DEFAULT_SWARM_MAX_DEPTH = 3;
/** Assistant-turn cap for the verifier / planner / judge agents. */
export const DEFAULT_SWARM_AUX_MAX_ITERATIONS = 12;
/** Default retries for a worker that errors or returns nothing. */
export const DEFAULT_SWARM_RETRIES = 1;

const execFileAsync = promisify(execFile);

// ============================================================================
// Fork context + options
// ============================================================================

/**
 * Everything a worker {@link Agent} needs, inherited from the parent for auth +
 * prefix-cache parity. Read lazily at launch time off the live parent agent.
 */
export interface SwarmForkContext {
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
	/** Working directory the workers operate in. */
	cwd: string;
}

export interface AgentSwarmToolOptions {
	/** Lazily resolve the fork context from the live parent agent at launch time. */
	getForkContext: () => SwarmForkContext;
	/** Default concurrency when the call omits `max_concurrency`. Default 8. */
	defaultConcurrency?: number;
	/** Hard cap on tasks accepted per call. Default 100. */
	maxWorkers?: number;
	/** Default assistant-turn cap per worker. Undefined/0 = unlimited (the default). */
	maxIterationsPerWorker?: number;
	/** Override the base toolset handed to each worker. Default: scoped coding tools. */
	buildWorkerTools?: (cwd: string) => AgentTool[];
	/** Max recursive sub-swarm nesting. Default 3. Set 0 to disable recursion. */
	maxDepth?: number;
	/** Current nesting depth. Internal — set automatically for nested sub-swarms. */
	depth?: number;
	/** Run the verifier pass even when a call omits `verify`. Default false. */
	defaultVerify?: boolean;
}

// ============================================================================
// Result types
// ============================================================================

export interface SwarmWorkerResult {
	/** Stable label for this worker (the task `id`, or `agent-<n>`). */
	id: string;
	/** The task prompt this worker was given (shared context stripped). */
	prompt: string;
	/** Terminal status of the worker. */
	status: "ok" | "error" | "aborted";
	/** Final assistant text the worker produced (empty on hard failure). */
	output: string;
	/** Failure message when `status === "error"`. */
	error?: string;
	/** Number of completed assistant turns. */
	turns: number;
	/** How many attempts it took (1 = succeeded first try). */
	attempts?: number;
	/** Path to the saved transcript, when `save_transcripts` was set. */
	transcriptPath?: string;
	/** Worktree directory holding this worker's changes, when isolated and dirty. */
	worktree?: string;
	/** Git branch for this worker's worktree, when isolated and dirty. */
	branch?: string;
}

/** Output of the optional verifier pass. */
export interface SwarmVerification {
	critique: string;
	status: "ok" | "error" | "aborted";
}

/** Output of the consensus judge. */
export interface SwarmConsensus {
	status: "ok" | "error" | "aborted";
	/** Id of the winning sample, when the judge named one. */
	chosenId?: string;
	/** The judge's full reasoning. */
	reasoning: string;
}

export interface AgentSwarmToolDetails {
	workers: SwarmWorkerResult[];
	/** Effective concurrency used for this run. */
	concurrency: number;
	/** Number of workers still pending (for streaming updates). */
	pending: number;
	/** Nesting depth this swarm ran at (0 = top level). */
	depth: number;
	/** Short id for this swarm run (used for worktrees/transcripts). */
	runId: string;
	/** The goal that was auto-decomposed, when planner mode ran. */
	goal?: string;
	/** Verifier result, when the verify pass ran. */
	verification?: SwarmVerification;
	/** Judge result, when consensus mode ran. */
	consensus?: SwarmConsensus;
}

// ============================================================================
// Schema
// ============================================================================

const taskSchema = Type.Object({
	id: Type.Optional(
		Type.String({
			description: "Optional short label for this agent's task (shown in output). Defaults to agent-<n>.",
		}),
	),
	prompt: Type.String({
		description:
			"The full, self-contained instruction for this agent. It runs in isolation with no memory of the other agents, so include everything it needs.",
	}),
	depends_on: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Ids of other tasks in THIS call that must finish before this agent starts. This agent then receives those agents' outputs in its prompt, so it builds on real results instead of guessing. Use for pipelines (e.g. the backend task depends_on the frontend task so it sees the actual API shape). Omit for independent tasks that run immediately. If a dependency fails, this task is skipped.",
		}),
	),
});

const agentSwarmSchema = Type.Object({
	goal: Type.Optional(
		Type.String({
			description:
				"High-level goal to auto-decompose into independent parallel subtasks via a planner agent. Provide this OR tasks; if both are given, tasks win.",
		}),
	),
	tasks: Type.Optional(
		Type.Array(taskSchema, {
			description:
				"One entry per agent to spawn. Each agent runs in parallel in its own fresh context with the standard coding tools. Give disjoint, non-overlapping work to avoid conflicting file edits.",
		}),
	),
	shared_context: Type.Optional(
		Type.String({
			description:
				"Optional briefing prepended to every agent's prompt — background that all agents share, so you don't repeat it in each task.",
		}),
	),
	max_concurrency: Type.Optional(
		Type.Number({
			description:
				"Maximum number of agents running at the same time. Defaults to 8. The rest queue and run as slots free up.",
		}),
	),
	verify: Type.Optional(
		Type.Boolean({
			description:
				"When true, spawn one extra agent after the workers finish to cross-check their merged output against the codebase and report problems. Recommended with fast models.",
		}),
	),
	consensus_samples: Type.Optional(
		Type.Number({
			description:
				"Run the FIRST task this many times in parallel and have a judge pick the single best answer (self-consistency). Use for one hard question where a fast model is unreliable. Ignores extra tasks.",
		}),
	),
	quorum: Type.Optional(
		Type.Number({
			description:
				"Return as soon as this many agents succeed, aborting the rest. Use when any one good result is enough.",
		}),
	),
	max_total_turns: Type.Optional(
		Type.Number({
			description:
				"Total assistant-turn budget across all agents. The swarm stops launching and aborts once exceeded.",
		}),
	),
	retry: Type.Optional(
		Type.Number({
			description: "How many times to retry an agent that errors or returns nothing. Default 1.",
		}),
	),
	max_turns_per_agent: Type.Optional(
		Type.Number({
			description:
				"Cap each agent at this many assistant turns as a runaway backstop. Default: unlimited (agents run to completion like you do). Set a number for big fan-outs where a stuck agent would be costly.",
		}),
	),
	blackboard: Type.Optional(
		Type.Boolean({
			description:
				"Give agents a shared notebook (swarm_note tool) to post and read each other's findings. Use for collaborative investigation.",
		}),
	),
	isolate: Type.Optional(
		Type.Union([Type.Literal("worktree")], {
			description:
				'Set to "worktree" to run each agent in its own git worktree/branch so parallel edits never collide. Worktrees with changes are left for you to review and merge; clean ones are removed.',
		}),
	),
	save_transcripts: Type.Optional(
		Type.Boolean({
			description: "Save each agent's full transcript under .flame/swarm/<runId>/ for debugging.",
		}),
	),
});

export type AgentSwarmToolInput = Static<typeof agentSwarmSchema>;

interface SwarmTask {
	id?: string;
	prompt: string;
	/** Ids of tasks that must finish before this one runs (dependency DAG). */
	dependsOn?: string[];
	/** Upstream dependency results injected into the prompt by the scheduler. */
	upstream?: string;
}

/** Shared notebook for the blackboard feature. */
interface Blackboard {
	notes: { from: string; text: string }[];
}

/** Per-run configuration threaded into each worker. */
interface WorkerRunConfig {
	ctx: SwarmForkContext;
	options: AgentSwarmToolOptions;
	sharedContext?: string;
	depth: number;
	retries: number;
	/** Per-worker assistant-turn cap; undefined = unlimited. */
	maxTurns?: number;
	blackboard?: Blackboard;
	transcriptDir?: string;
	signal: AbortSignal | undefined;
	isolate?: "worktree";
	repoRoot?: string;
	runId: string;
}

// ============================================================================
// Toolsets
// ============================================================================

/** Default scoped toolset for a worker: the standard coding tools, bound to cwd. */
function defaultBuildWorkerTools(cwd: string): AgentTool[] {
	return [
		createReadTool(cwd),
		createGrepTool(cwd),
		createFindTool(cwd),
		createLsTool(cwd),
		createBashTool(cwd),
		createWriteTool(cwd),
		createEditTool(cwd),
		createWebSearchTool(cwd),
	];
}

/** Read-only toolset for the verifier/planner/judge so they can inspect the tree. */
function buildAuxTools(cwd: string): AgentTool[] {
	return [createReadTool(cwd), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd)];
}

/**
 * Base toolset for a worker plus, while under the depth cap, a nested
 * `agent_swarm` tool so the worker can fan its subtask out one level deeper.
 */
export function buildWorkerToolset(ctx: SwarmForkContext, options: AgentSwarmToolOptions, depth: number): AgentTool[] {
	const tools = (options.buildWorkerTools ?? defaultBuildWorkerTools)(ctx.cwd);
	const maxDepth = Math.max(0, options.maxDepth ?? DEFAULT_SWARM_MAX_DEPTH);
	if (depth < maxDepth) {
		// Nested swarm shares the fork context but runs one level deeper, so its
		// own workers stop recursing once the cap is hit.
		tools.push(createAgentSwarmTool({ ...options, depth: depth + 1 }));
	}
	return tools;
}

const swarmNoteSchema = Type.Object({
	note: Type.String({ description: "A concise finding to share with the other agents in this swarm." }),
});

/** A `swarm_note` tool bound to one agent + the shared board (blackboard feature). */
function createSwarmNoteTool(board: Blackboard, agentId: string): AgentTool {
	const def: ToolDefinition<typeof swarmNoteSchema, { count: number }> = {
		name: "swarm_note",
		label: "swarm note",
		description:
			"Post a short finding to the shared swarm notebook and read back every note posted so far by all agents. Use it to coordinate and avoid duplicate work.",
		parameters: swarmNoteSchema,
		async execute(_id, { note }) {
			board.notes.push({ from: agentId, text: note });
			const all = board.notes.map((n) => `- [${n.from}] ${n.text}`).join("\n");
			return {
				content: [
					{ type: "text", text: `Noted. The shared notebook now has ${board.notes.length} note(s):\n${all}` },
				],
				details: { count: board.notes.length },
			};
		},
	};
	return wrapToolDefinition(def);
}

function blackboardSnapshot(board: Blackboard | undefined): string {
	if (!board || board.notes.length === 0) {
		return "";
	}
	return `Shared notebook (notes from other agents so far):\n${board.notes.map((n) => `- [${n.from}] ${n.text}`).join("\n")}`;
}

// ============================================================================
// Agent run helpers
// ============================================================================

function agentForkOptions(ctx: SwarmForkContext) {
	return {
		convertToLlm: ctx.convertToLlm,
		streamFn: ctx.streamFn,
		transport: ctx.transport,
		thinkingBudgets: ctx.thinkingBudgets,
		maxRetryDelayMs: ctx.maxRetryDelayMs,
		sessionId: ctx.sessionId,
	};
}

/** The most recent assistant message, if any. */
function lastAssistantMessage(messages: AgentMessage[]): Extract<AgentMessage, { role: "assistant" }> | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "assistant") {
			return msg;
		}
	}
	return undefined;
}

/** Concatenated text of the last non-empty assistant message. */
function extractFinalText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") {
			continue;
		}
		const text = msg.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
		if (text) {
			return text;
		}
	}
	return "";
}

/**
 * Drive an Agent to completion on `prompt` with a per-turn iteration backstop
 * and abort propagation. Returns the terminal status and final text. Throws only
 * on a hard construction/stream failure the Agent loop didn't absorb.
 */
async function runAgentToCompletion(
	agent: Agent,
	prompt: string,
	maxIterations: number | undefined,
	signal: AbortSignal | undefined,
): Promise<{ status: "ok" | "error" | "aborted"; output: string; error?: string; turns: number }> {
	// undefined / 0 / negative = no cap; the worker runs to completion like the
	// main agent. A positive cap is a runaway backstop.
	const cap = maxIterations && maxIterations > 0 ? maxIterations : undefined;
	let turns = 0;
	const unsubscribe = agent.subscribe((event) => {
		if (event.type === "turn_end") {
			turns++;
			if (cap !== undefined && turns >= cap) {
				agent.abort();
			}
		}
	});
	const onAbort = () => agent.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		await agent.prompt(prompt);
	} finally {
		unsubscribe();
		signal?.removeEventListener("abort", onAbort);
	}

	const output = extractFinalText(agent.state.messages);
	// The Agent loop swallows stream/provider failures into an error-stopReason
	// message rather than throwing, so inspect the final turn the same way the
	// parent session gates its background review (`_findLastAssistantMessage`).
	const stopReason = lastAssistantMessage(agent.state.messages)?.stopReason;
	if (signal?.aborted || stopReason === "aborted") {
		return { status: "aborted", output, turns };
	}
	if (stopReason === "error") {
		return { status: "error", output, error: agent.state.errorMessage || "agent run failed", turns };
	}
	return { status: "ok", output, turns };
}

function writeTranscript(dir: string | undefined, id: string, messages: AgentMessage[]): string | undefined {
	if (!dir) {
		return undefined;
	}
	try {
		mkdirSync(dir, { recursive: true });
		const file = join(dir, `${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`);
		writeFileSync(file, JSON.stringify(messages, null, 2), "utf-8");
		return file;
	} catch {
		return undefined;
	}
}

function buildWorkerPrompt(
	task: SwarmTask,
	sharedContext: string | undefined,
	board: Blackboard | undefined,
	attempt: number,
	lastError: string | undefined,
): string {
	const parts: string[] = [];
	if (attempt > 0) {
		parts.push(
			`Your previous attempt did not succeed${lastError ? ` (${lastError})` : ""}. Please try again and complete the task.`,
		);
	}
	if (sharedContext) {
		parts.push(sharedContext);
	}
	const snap = blackboardSnapshot(board);
	if (snap) {
		parts.push(snap);
	}
	if (task.upstream) {
		parts.push(task.upstream);
	}
	parts.push(task.prompt);
	return parts.join("\n\n---\n\n");
}

// ============================================================================
// Worker
// ============================================================================

/** Spawn and run a single worker agent to completion, with retries. Never throws. */
async function runWorker(task: SwarmTask, index: number, config: WorkerRunConfig): Promise<SwarmWorkerResult> {
	const { ctx, options, sharedContext, depth, blackboard, transcriptDir, signal } = config;
	const retries = Math.max(0, config.retries);
	const id = task.id?.trim() || `agent-${index + 1}`;
	const maxIterations = config.maxTurns;
	let attempt = 0;
	let lastError: string | undefined;

	while (true) {
		try {
			if (signal?.aborted) {
				return { id, prompt: task.prompt, status: "aborted", output: "", turns: 0, attempts: attempt };
			}
			const tools = buildWorkerToolset(ctx, options, depth);
			if (blackboard) {
				tools.push(createSwarmNoteTool(blackboard, id));
			}
			const worker = new Agent({
				initialState: {
					systemPrompt: ctx.baseSystemPrompt,
					model: ctx.model,
					thinkingLevel: ctx.thinkingLevel ?? "off",
					tools,
				},
				...agentForkOptions(ctx),
			});
			const prompt = buildWorkerPrompt(task, sharedContext, blackboard, attempt, lastError);
			const run = await runAgentToCompletion(worker, prompt, maxIterations, signal);
			const transcriptPath = writeTranscript(transcriptDir, id, worker.state.messages);
			const result: SwarmWorkerResult = { id, prompt: task.prompt, ...run, attempts: attempt + 1, transcriptPath };

			const emptyOk = result.status === "ok" && !result.output.trim();
			if ((result.status === "error" || emptyOk) && attempt < retries && !signal?.aborted) {
				lastError = result.error ?? (emptyOk ? "returned no output" : undefined);
				attempt++;
				continue;
			}
			return result;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (attempt < retries && !signal?.aborted) {
				lastError = msg;
				attempt++;
				continue;
			}
			return {
				id,
				prompt: task.prompt,
				status: signal?.aborted ? "aborted" : "error",
				output: "",
				error: msg,
				turns: 0,
				attempts: attempt + 1,
			};
		}
	}
}

// ============================================================================
// Worktree isolation
// ============================================================================

async function git(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
	return stdout.trim();
}

/** Repo root for `cwd`, or undefined when not inside a git work tree. */
async function repoRootOf(cwd: string): Promise<string | undefined> {
	try {
		return await git(["rev-parse", "--show-toplevel"], cwd);
	} catch {
		return undefined;
	}
}

/** Run a worker inside its own git worktree, leaving it behind only if it made changes. */
async function runIsolatedWorker(task: SwarmTask, index: number, config: WorkerRunConfig): Promise<SwarmWorkerResult> {
	const repoRoot = config.repoRoot;
	if (!repoRoot) {
		return runWorker(task, index, config);
	}
	const id = task.id?.trim() || `agent-${index + 1}`;
	const safe = id.replace(/[^a-zA-Z0-9._-]/g, "-");
	const branch = `swarm/${config.runId}/${safe}`;
	const dir = join(tmpdir(), `flame-swarm-${config.runId}`, safe);
	try {
		mkdirSync(join(tmpdir(), `flame-swarm-${config.runId}`), { recursive: true });
		await git(["worktree", "add", "-b", branch, dir, "HEAD"], repoRoot);
	} catch (error) {
		// Couldn't isolate — fall back to the shared cwd rather than failing.
		const fallback = await runWorker(task, index, config);
		const note = error instanceof Error ? error.message : String(error);
		return { ...fallback, error: fallback.error ?? `worktree setup failed: ${note}` };
	}

	// Disable nested recursion under isolation: a nested swarm would use the
	// original cwd, defeating the isolation, so cap depth for this worker.
	const isoConfig: WorkerRunConfig = {
		...config,
		ctx: { ...config.ctx, cwd: dir },
		options: { ...config.options, maxDepth: 0 },
	};
	const result = await runWorker(task, index, isoConfig);

	let kept = false;
	try {
		const status = await git(["status", "--porcelain"], dir);
		kept = status.length > 0;
		if (!kept) {
			await git(["worktree", "remove", "--force", dir], repoRoot).catch(() => {});
			await git(["branch", "-D", branch], repoRoot).catch(() => {});
		}
	} catch {
		// Leave the worktree in place if we can't determine its state.
		kept = true;
	}
	return kept ? { ...result, worktree: dir, branch } : result;
}

// ============================================================================
// Pool
// ============================================================================

/** The stable label a worker is reported under: its task id, or `agent-<n>`. */
function taskId(task: SwarmTask, index: number): string {
	return task.id?.trim() || `agent-${index + 1}`;
}

function abortedStub(task: SwarmTask, index: number): SwarmWorkerResult {
	return { id: taskId(task, index), prompt: task.prompt, status: "aborted", output: "", turns: 0 };
}

/** A worker we never ran because an upstream dependency didn't succeed. */
function skippedStub(task: SwarmTask, index: number, reason: string): SwarmWorkerResult {
	return { id: taskId(task, index), prompt: task.prompt, status: "aborted", output: "", error: reason, turns: 0 };
}

/**
 * Run `runOne` over `tasks` with at most `concurrency` in flight. Tasks dequeued
 * after `signal` aborts resolve immediately as aborted stubs (for quorum/budget
 * early-exit). `onEach` fires as each worker settles, in completion order.
 */
async function runWorkerPool(
	tasks: SwarmTask[],
	concurrency: number,
	signal: AbortSignal,
	runOne: (task: SwarmTask, index: number) => Promise<SwarmWorkerResult>,
	onEach: (result: SwarmWorkerResult) => void,
): Promise<SwarmWorkerResult[]> {
	const results = new Array<SwarmWorkerResult>(tasks.length);
	let next = 0;
	const lane = async (): Promise<void> => {
		while (true) {
			const index = next++;
			if (index >= tasks.length) {
				return;
			}
			const task = tasks[index]!;
			const result = signal.aborted ? abortedStub(task, index) : await runOne(task, index);
			results[index] = result;
			onEach(result);
		}
	};
	const lanes = Math.max(1, Math.min(concurrency, tasks.length));
	await Promise.all(Array.from({ length: lanes }, () => lane()));
	return results;
}

/** Chain an internal AbortController off an optional parent signal. */
function linkedAbort(parent: AbortSignal | undefined): { signal: AbortSignal; abort: () => void; cleanup: () => void } {
	const controller = new AbortController();
	const onParent = () => controller.abort();
	if (parent) {
		if (parent.aborted) {
			controller.abort();
		} else {
			parent.addEventListener("abort", onParent, { once: true });
		}
	}
	return {
		signal: controller.signal,
		abort: () => controller.abort(),
		cleanup: () => parent?.removeEventListener("abort", onParent),
	};
}

// ============================================================================
// Dependency DAG
// ============================================================================

/**
 * Resolve each task's `depends_on` ids to indices in `tasks`. Unknown ids and
 * self-references are dropped (they never block). Returns the per-task dependency
 * index lists plus a label lookup.
 */
function resolveDependencies(tasks: SwarmTask[]): { depIndices: number[][]; labelOf: (i: number) => string } {
	const labelOf = (i: number) => taskId(tasks[i]!, i);
	const idToIndex = new Map<string, number>();
	tasks.forEach((_, i) => {
		idToIndex.set(labelOf(i), i);
	});
	const depIndices = tasks.map((task, i) =>
		(task.dependsOn ?? [])
			.map((id) => idToIndex.get(id.trim()))
			.filter((d): d is number => d !== undefined && d !== i),
	);
	return { depIndices, labelOf };
}

/** True when at least one task declares a dependency (i.e. we need DAG ordering). */
function hasDependencies(depIndices: number[][]): boolean {
	return depIndices.some((deps) => deps.length > 0);
}

/** Build the "here are your upstream results" block injected into a dependent's prompt. */
function buildUpstreamContext(deps: number[], results: SwarmWorkerResult[]): string | undefined {
	if (deps.length === 0) {
		return undefined;
	}
	const blocks = deps.map((d) => {
		const r = results[d]!;
		return `### Output from "${r.id}"\n${r.output || "(no output)"}`;
	});
	return [
		"Results from the agent(s) this task depends on. Build on these directly — do not re-derive or guess what they produced:",
		"",
		...blocks,
	].join("\n");
}

/**
 * Run `tasks` honoring a dependency DAG: a task starts only once all of its
 * dependencies have settled, and it receives their outputs injected into its
 * prompt. A task whose dependency failed/aborted is skipped (cascading). Tasks
 * with no deps behave exactly like a flat fan-out. Respects `concurrency` and
 * the abort `signal`; `onEach` fires as each task settles.
 */
async function runDagPool(
	tasks: SwarmTask[],
	depIndices: number[][],
	concurrency: number,
	signal: AbortSignal,
	runOne: (task: SwarmTask, index: number) => Promise<SwarmWorkerResult>,
	onEach: (result: SwarmWorkerResult) => void,
): Promise<SwarmWorkerResult[]> {
	const results = new Array<SwarmWorkerResult>(tasks.length);
	const done = new Array<boolean>(tasks.length).fill(false);
	let doneCount = 0;
	const inflight = new Map<number, Promise<void>>();

	const finish = (index: number, result: SwarmWorkerResult) => {
		results[index] = result;
		done[index] = true;
		doneCount++;
		onEach(result);
	};

	while (doneCount < tasks.length) {
		// Schedule every ready task we have slots for. Skips settle synchronously,
		// so a failed dependency cascades through its dependents within this pass.
		for (let i = 0; i < tasks.length && inflight.size < concurrency; i++) {
			if (done[i] || inflight.has(i)) {
				continue;
			}
			const deps = depIndices[i]!;
			if (!deps.every((d) => done[d])) {
				continue;
			}
			if (signal.aborted) {
				continue; // stubbed below once nothing is in flight
			}
			const failed = deps.find((d) => results[d]!.status !== "ok");
			if (failed !== undefined) {
				finish(i, skippedStub(tasks[i]!, i, `skipped: dependency "${results[failed]!.id}" did not succeed`));
				continue;
			}
			const task: SwarmTask = { ...tasks[i]!, upstream: buildUpstreamContext(deps, results) };
			const index = i;
			const promise = runOne(task, index)
				.then((r) => finish(index, r))
				.finally(() => inflight.delete(index));
			inflight.set(index, promise);
		}

		if (doneCount >= tasks.length) {
			break;
		}
		if (inflight.size === 0) {
			// Nothing runnable and nothing running: the rest are blocked by the abort
			// or by an unresolvable dependency cycle. Settle them so we don't hang.
			for (let i = 0; i < tasks.length; i++) {
				if (!done[i]) {
					finish(
						i,
						signal.aborted
							? abortedStub(tasks[i]!, i)
							: skippedStub(tasks[i]!, i, "skipped: unresolved dependency cycle"),
					);
				}
			}
			break;
		}
		await Promise.race(inflight.values());
	}
	return results;
}

// ============================================================================
// Planner / verifier / judge
// ============================================================================

function extractJsonArray(text: string): string | undefined {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = fence?.[1] ?? text;
	const start = body.indexOf("[");
	const end = body.lastIndexOf("]");
	if (start === -1 || end === -1 || end < start) {
		return undefined;
	}
	return body.slice(start, end + 1);
}

/** Parse a planner's reply into tasks. Tolerant of prose around the JSON. */
function parsePlannedTasks(text: string): SwarmTask[] {
	const json = extractJsonArray(text);
	if (!json) {
		return [];
	}
	try {
		const arr = JSON.parse(json);
		if (!Array.isArray(arr)) {
			return [];
		}
		return arr
			.map((entry): SwarmTask => {
				if (typeof entry === "string") {
					return { prompt: entry };
				}
				const id = typeof entry?.id === "string" ? entry.id : undefined;
				const prompt = typeof entry?.prompt === "string" ? entry.prompt : "";
				const dependsOn = Array.isArray(entry?.depends_on)
					? entry.depends_on.filter((d: unknown): d is string => typeof d === "string")
					: undefined;
				return { id, prompt, dependsOn };
			})
			.filter((t) => t.prompt.trim().length > 0);
	} catch {
		return [];
	}
}

/** Decompose a goal into parallel subtasks via a planner agent. Never throws. */
async function planTasks(
	goal: string,
	ctx: SwarmForkContext,
	signal: AbortSignal | undefined,
): Promise<{ tasks: SwarmTask[]; error?: string }> {
	try {
		const planner = new Agent({
			initialState: {
				systemPrompt: ctx.baseSystemPrompt,
				model: ctx.model,
				thinkingLevel: ctx.thinkingLevel ?? "off",
				tools: buildAuxTools(ctx.cwd),
			},
			...agentForkOptions(ctx),
		});
		const prompt = [
			"You are a planner for a parallel agent swarm.",
			`Goal: ${goal}`,
			"Break this into subtasks. Prefer INDEPENDENT subtasks that can run in parallel (split by file, module, or area).",
			"When one subtask genuinely needs another's result (e.g. the backend needs the frontend's API shape), express that with depends_on instead of forcing it into one task — the dependent agent will receive the upstream agent's output automatically and won't have to guess.",
			"Use your read-only tools to inspect the repo as needed.",
			'Reply with ONLY a JSON array. Each element: {"id": "short-label", "prompt": "complete self-contained instruction", "depends_on": ["other-id", ...]}.',
			"Omit depends_on (or use []) for subtasks that can start immediately. Reference ids that exist in this array. Do not create cycles.",
			"Keep it to a sensible number of tasks (usually 2-12).",
		].join("\n");
		const run = await runAgentToCompletion(planner, prompt, DEFAULT_SWARM_AUX_MAX_ITERATIONS, signal);
		const tasks = parsePlannedTasks(run.output);
		if (tasks.length === 0) {
			return { tasks: [], error: "planner did not return any usable tasks" };
		}
		return { tasks };
	} catch (error) {
		return { tasks: [], error: error instanceof Error ? error.message : String(error) };
	}
}

/** Build the verifier's review prompt from the completed worker transcripts. */
function buildVerifierPrompt(workers: SwarmWorkerResult[]): string {
	const blocks = workers.map((w) => {
		const status = w.status === "ok" ? "completed" : w.status;
		const body = w.status === "error" ? `ERROR: ${w.error || "(no message)"}` : w.output || "(no output)";
		return `### Agent "${w.id}" (${status})\nTask: ${w.prompt}\nResult:\n${body}`;
	});
	return [
		"You are a verifier. Several sub-agents each completed one task in parallel; their tasks and results are below.",
		"Cross-check the results against the actual codebase using your read-only tools (read, grep, find, ls).",
		"Look for: factual errors, unfinished work, contradictions between agents, and claims not supported by the code.",
		"Be concise. If everything checks out, reply exactly: VERIFIED: no issues found.",
		"Otherwise list the specific problems and which agent they came from.",
		"",
		...blocks,
	].join("\n");
}

/** Run the verifier pass over the worker results. Never throws. */
async function runVerifier(
	ctx: SwarmForkContext,
	workers: SwarmWorkerResult[],
	signal: AbortSignal | undefined,
): Promise<SwarmVerification> {
	try {
		const verifier = new Agent({
			initialState: {
				systemPrompt: ctx.baseSystemPrompt,
				model: ctx.model,
				thinkingLevel: ctx.thinkingLevel ?? "off",
				tools: buildAuxTools(ctx.cwd),
			},
			...agentForkOptions(ctx),
		});
		const run = await runAgentToCompletion(
			verifier,
			buildVerifierPrompt(workers),
			DEFAULT_SWARM_AUX_MAX_ITERATIONS,
			signal,
		);
		return {
			status: run.status,
			critique: run.status === "error" ? run.error || "verifier failed" : run.output || "(no critique)",
		};
	} catch (error) {
		return { status: "error", critique: error instanceof Error ? error.message : String(error) };
	}
}

/** Judge N consensus samples and pick the best. Never throws. */
async function runJudge(
	question: string,
	samples: SwarmWorkerResult[],
	ctx: SwarmForkContext,
	signal: AbortSignal | undefined,
): Promise<SwarmConsensus> {
	try {
		const judge = new Agent({
			initialState: {
				systemPrompt: ctx.baseSystemPrompt,
				model: ctx.model,
				thinkingLevel: ctx.thinkingLevel ?? "off",
				tools: buildAuxTools(ctx.cwd),
			},
			...agentForkOptions(ctx),
		});
		const blocks = samples.map((s) => `### ${s.id}\n${s.output || "(no output)"}`).join("\n\n");
		const prompt = [
			"You are a judge. Several agents independently answered the SAME task. Pick the single best answer.",
			`Task: ${question}`,
			"",
			"Candidate answers:",
			blocks,
			"",
			'Reply with the winning id on the first line as "BEST: <id>", then one line explaining why.',
		].join("\n");
		const run = await runAgentToCompletion(judge, prompt, DEFAULT_SWARM_AUX_MAX_ITERATIONS, signal);
		const match = run.output.match(/BEST:\s*([^\n]+)/i);
		const chosenId = match?.[1]?.trim();
		return { status: run.status, chosenId, reasoning: run.output || "(no reasoning)" };
	} catch (error) {
		return { status: "error", reasoning: error instanceof Error ? error.message : String(error) };
	}
}

// ============================================================================
// Aggregation + rendering
// ============================================================================

function workerSection(w: SwarmWorkerResult): string {
	const tag = w.status === "ok" ? "ok" : w.status === "aborted" ? "aborted" : "error";
	// Non-ok workers (errors, and skipped/cycle-aborted ones) carry their reason in `error`.
	const body = w.status !== "ok" && w.error ? w.error : w.output || "(no output)";
	const wt = w.worktree ? `\n(worktree: ${w.worktree} · branch: ${w.branch})` : "";
	return `## ${w.id} [${tag}]${wt}\n${body}`;
}

/** Aggregate the per-worker transcripts into one model-facing text block. */
function aggregateOutput(
	workers: SwarmWorkerResult[],
	concurrency: number,
	extras: { verification?: SwarmVerification; consensus?: SwarmConsensus; goal?: string },
): string {
	const ok = workers.filter((w) => w.status === "ok").length;
	const failed = workers.filter((w) => w.status === "error").length;
	const aborted = workers.filter((w) => w.status === "aborted").length;
	const header =
		`Ran ${workers.length} agent(s) at concurrency ${concurrency} — ` +
		`${ok} ok${failed ? `, ${failed} error` : ""}${aborted ? `, ${aborted} aborted` : ""}.`;
	const parts: string[] = [];
	if (extras.goal) {
		parts.push(`Goal: ${extras.goal}`);
	}
	parts.push(header, "");

	if (extras.consensus) {
		const chosen = extras.consensus.chosenId ? workers.find((w) => w.id === extras.consensus?.chosenId) : undefined;
		parts.push(`## consensus [${extras.consensus.status}] — winner: ${extras.consensus.chosenId ?? "unspecified"}`);
		parts.push(extras.consensus.reasoning);
		if (chosen) {
			parts.push("", `## winning answer (${chosen.id})`, chosen.output || "(no output)");
		}
		parts.push("", "<details: all samples below>");
	}

	parts.push(...workers.map(workerSection));

	if (extras.verification) {
		parts.push("", `## verification [${extras.verification.status}]`, extras.verification.critique);
	}
	return parts.join("\n");
}

function statusColor(status: SwarmWorkerResult["status"] | SwarmVerification["status"], theme: Theme): string {
	if (status === "ok") {
		return theme.fg("success", "ok");
	}
	if (status === "aborted") {
		return theme.fg("warning", "aborted");
	}
	return theme.fg("error", "error");
}

// ============================================================================
// Tool definition
// ============================================================================

export function createAgentSwarmToolDefinition(
	options: AgentSwarmToolOptions,
): ToolDefinition<typeof agentSwarmSchema, AgentSwarmToolDetails> {
	const maxWorkers = Math.max(1, options.maxWorkers ?? DEFAULT_SWARM_MAX_WORKERS);
	const defaultConcurrency = Math.max(1, options.defaultConcurrency ?? DEFAULT_SWARM_CONCURRENCY);

	return {
		name: "agent_swarm",
		label: "agent swarm",
		description:
			`Run many sub-agents in parallel. Pass "tasks" (one self-contained prompt each) or a single "goal" to have a ` +
			`planner split it into parallel subtasks. Each agent gets a fresh, isolated context with the standard coding ` +
			`tools (read, grep, find, ls, bash, write, edit, web_search) scoped to the current directory. For pipelines, give a ` +
			`task a depends_on=[ids]: it waits for those agents and receives their output in its prompt (so e.g. the backend ` +
			`agent builds on the frontend's real API instead of guessing). Up to ${maxWorkers} ` +
			`agents per call; max_concurrency (default ${defaultConcurrency}) run at once. All agents run on your model. ` +
			`Options: verify=true adds a checker pass; consensus_samples=N runs the first task N times and a judge picks the ` +
			`best (great for boosting fast models on hard questions); quorum=N returns after N succeed; blackboard=true lets ` +
			`agents share notes; isolate="worktree" gives each agent its own git branch so edits never collide; retry, ` +
			`max_total_turns, and save_transcripts round it out. Agents run with no turn limit by default (like you); set ` +
			`max_turns_per_agent for a backstop on big fan-outs. Agents can nest agent_swarm up to a fixed depth. Keep tasks ` +
			`disjoint to avoid conflicting edits.`,
		promptSnippet: "Run sub-agents in parallel",
		promptGuidelines: [
			"Use agent_swarm to parallelize independent subtasks; keep each agent's work disjoint to avoid conflicting edits.",
			"For one hard question on a fast model, use agent_swarm with consensus_samples to vote on the best answer.",
		],
		parameters: agentSwarmSchema,
		async execute(_toolCallId, params, signal, onUpdate) {
			const depth = Math.max(0, options.depth ?? 0);
			const ctx = options.getForkContext();
			const runId = Math.random().toString(16).slice(2, 10);
			const goal = params.goal?.trim() || undefined;

			let phase: "plan" | "agents" | "judge" | "verify" = "agents";
			let concurrency = 0;
			let total = 0;
			const completed: SwarmWorkerResult[] = [];
			const emitProgress = () => {
				if (!onUpdate) {
					return;
				}
				const done = completed.length;
				const label =
					phase === "plan"
						? "agent_swarm: planning subtasks…"
						: phase === "verify"
							? `agent_swarm: ${done}/${total} agents done, verifying…`
							: phase === "judge"
								? `agent_swarm: ${done}/${total} samples done, judging…`
								: `agent_swarm: ${done}/${total} agents finished…`;
				onUpdate({
					content: [{ type: "text", text: label }],
					details: {
						workers: completed.slice(),
						concurrency,
						pending: Math.max(0, total - done),
						depth,
						runId,
						goal,
					},
				});
			};

			// --- Resolve tasks (explicit or via the planner) ---
			let tasks: SwarmTask[] = (params.tasks ?? [])
				.filter((t) => t.prompt.trim().length > 0)
				.map((t) => ({ id: t.id, prompt: t.prompt, dependsOn: t.depends_on }));
			let plannerError: string | undefined;
			if (tasks.length === 0 && goal) {
				phase = "plan";
				emitProgress();
				const planned = await planTasks(goal, ctx, signal);
				tasks = planned.tasks;
				plannerError = planned.error;
				phase = "agents";
			}
			if (tasks.length === 0) {
				const msg = plannerError
					? `agent_swarm: planner produced no tasks (${plannerError}).`
					: "agent_swarm: provide either tasks or a goal.";
				return {
					content: [{ type: "text", text: msg }],
					details: { workers: [], concurrency: 0, pending: 0, depth, runId, goal },
				};
			}
			if (tasks.length > maxWorkers) {
				return {
					content: [
						{
							type: "text",
							text: `agent_swarm: ${tasks.length} tasks exceeds the limit of ${maxWorkers} per call. Split into multiple calls.`,
						},
					],
					details: { workers: [], concurrency: 0, pending: 0, depth, runId, goal },
				};
			}

			const sharedContext = params.shared_context?.trim() || undefined;
			const consensusSamples = Math.floor(params.consensus_samples ?? 0);
			// Per-worker turn cap: param wins, then embedder option, else unlimited.
			const maxTurns =
				params.max_turns_per_agent !== undefined
					? Math.max(0, Math.floor(params.max_turns_per_agent))
					: options.maxIterationsPerWorker;

			// --- Consensus mode: run the first task N times, then judge ---
			if (consensusSamples >= 2) {
				const question = tasks[0]!.prompt;
				const n = Math.min(consensusSamples, maxWorkers);
				const samples: SwarmTask[] = Array.from({ length: n }, (_, i) => ({
					id: `sample-${i + 1}`,
					prompt: question,
				}));
				total = samples.length;
				concurrency = Math.max(
					1,
					Math.min(Math.floor(params.max_concurrency ?? defaultConcurrency) || defaultConcurrency, n),
				);
				emitProgress();

				const config: WorkerRunConfig = { ctx, options, sharedContext, depth, retries: 0, maxTurns, signal, runId };
				const linked = linkedAbort(signal);
				const workers = await runWorkerPool(
					samples,
					concurrency,
					linked.signal,
					(task, index) => runWorker(task, index, { ...config, signal: linked.signal }),
					(r) => {
						completed.push(r);
						emitProgress();
					},
				);
				linked.cleanup();

				phase = "judge";
				emitProgress();
				const consensus = signal?.aborted ? undefined : await runJudge(question, workers, ctx, signal);
				return {
					content: [{ type: "text", text: aggregateOutput(workers, concurrency, { consensus, goal }) }],
					details: { workers, concurrency, pending: 0, depth, runId, goal, consensus },
				};
			}

			// --- Normal mode: parallel pool with quorum / budget / retry / etc. ---
			total = tasks.length;
			concurrency = Math.max(
				1,
				Math.min(Math.floor(params.max_concurrency ?? defaultConcurrency) || defaultConcurrency, tasks.length),
			);
			const blackboard: Blackboard | undefined = params.blackboard ? { notes: [] } : undefined;
			const isolate = params.isolate;
			const repoRoot = isolate === "worktree" ? await repoRootOf(ctx.cwd) : undefined;
			const transcriptDir = params.save_transcripts ? join(ctx.cwd, ".flame", "swarm", runId) : undefined;
			const retries = Math.max(0, Math.floor(params.retry ?? DEFAULT_SWARM_RETRIES));
			const quorum = params.quorum ? Math.max(1, Math.floor(params.quorum)) : undefined;
			const maxTotalTurns = params.max_total_turns ? Math.max(1, Math.floor(params.max_total_turns)) : undefined;
			emitProgress();

			const linked = linkedAbort(signal);
			let totalTurns = 0;
			let okCount = 0;
			const onEach = (r: SwarmWorkerResult) => {
				completed.push(r);
				totalTurns += r.turns;
				if (r.status === "ok") {
					okCount++;
				}
				if (quorum && okCount >= quorum) {
					linked.abort();
				}
				if (maxTotalTurns && totalTurns >= maxTotalTurns) {
					linked.abort();
				}
				emitProgress();
			};

			const config: WorkerRunConfig = {
				ctx,
				options,
				sharedContext,
				depth,
				retries,
				maxTurns,
				blackboard,
				transcriptDir,
				signal: linked.signal,
				isolate,
				repoRoot,
				runId,
			};
			const runOne = (task: SwarmTask, index: number) =>
				isolate === "worktree" ? runIsolatedWorker(task, index, config) : runWorker(task, index, config);

			// A dependency DAG (any task with depends_on) orders the run so dependents
			// start only after their upstreams finish and receive their output; with no
			// dependencies the scheduler degrades to a plain bounded fan-out.
			const { depIndices } = resolveDependencies(tasks);
			const workers = hasDependencies(depIndices)
				? await runDagPool(tasks, depIndices, concurrency, linked.signal, runOne, onEach)
				: await runWorkerPool(tasks, concurrency, linked.signal, runOne, onEach);
			linked.cleanup();

			// Optional verifier pass: cross-check the merged output. Skipped when the
			// parent aborted or when every worker hard-failed (nothing to verify).
			const wantVerify = params.verify ?? options.defaultVerify ?? false;
			let verification: SwarmVerification | undefined;
			if (wantVerify && !signal?.aborted && workers.some((w) => w.status === "ok")) {
				phase = "verify";
				emitProgress();
				verification = await runVerifier(ctx, workers, signal);
			}

			return {
				content: [{ type: "text", text: aggregateOutput(workers, concurrency, { verification, goal }) }],
				details: { workers, concurrency, pending: 0, depth, runId, goal, verification },
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const count = Array.isArray(args?.tasks) ? args.tasks.length : 0;
			const label = args?.goal ? "goal" : `${count} agent${count === 1 ? "" : "s"}`;
			text.setText(`${theme.fg("toolTitle", theme.bold("agent_swarm"))} ${theme.fg("accent", label)}`);
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details;
			const workers = details?.workers ?? [];
			if (workers.length === 0) {
				text.setText(theme.fg("toolOutput", "agent_swarm: no agents ran"));
				return text;
			}
			const lines = workers.map((w) => {
				const turns = `${w.turns} turn${w.turns === 1 ? "" : "s"}`;
				const retry = w.attempts && w.attempts > 1 ? ` ×${w.attempts}` : "";
				const wt = w.branch ? ` ${theme.fg("muted", w.branch)}` : "";
				return `${theme.fg("accent", w.id)} ${statusColor(w.status, theme)} ${theme.fg("muted", `(${turns}${retry})`)}${wt}`;
			});
			if (details && details.pending > 0) {
				lines.push(theme.fg("muted", `… ${details.pending} pending`));
			}
			const maxLines = options.expanded ? lines.length : 12;
			const shown = lines.slice(0, maxLines);
			if (lines.length > maxLines) {
				shown.push(theme.fg("muted", `… and ${lines.length - maxLines} more`));
			}
			if (details?.consensus) {
				shown.push(
					`${theme.fg("toolTitle", "judge")} ${statusColor(details.consensus.status, theme)} ${theme.fg("muted", `→ ${details.consensus.chosenId ?? "?"}`)}`,
				);
			}
			if (details?.verification) {
				shown.push(`${theme.fg("toolTitle", "verifier")} ${statusColor(details.verification.status, theme)}`);
			}
			text.setText(shown.join("\n"));
			return text;
		},
	};
}

export function createAgentSwarmTool(options: AgentSwarmToolOptions): AgentTool<typeof agentSwarmSchema> {
	return wrapToolDefinition(createAgentSwarmToolDefinition(options));
}
