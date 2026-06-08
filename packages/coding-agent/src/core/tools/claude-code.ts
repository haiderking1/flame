/**
 * claude_code — delegate a task to the official Claude Code CLI as a subagent.
 *
 * The main model hands a self-contained task to this tool, which launches the
 * official `claude` binary in headless print mode
 * (`claude -p <task> --output-format json --permission-mode bypassPermissions`)
 * in the project directory, with permissions bypassed so the subagent can
 * actually edit files and run commands. Claude Code does the work and the final
 * result text (plus turns / cost / session id) is returned to the main model.
 *
 * This execs Anthropic's official CLI *directly* with an argument array — no
 * shell, no token extraction, no third-party harness. It uses whatever auth the
 * user's `claude` is already configured with, so Claude Code runs on its own
 * subscription/key, entirely separate from the flame model that called it.
 */
import { resolve } from "node:path";
import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { spawnProcess } from "../../utils/child-process.ts";
import { killProcessTree } from "../../utils/shell.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/** Default wall-clock cap for one delegated Claude Code run. */
export const DEFAULT_CLAUDE_CODE_TIMEOUT_SECONDS = 1800;
/** Default model the subagent runs on when the call doesn't override it. */
export const DEFAULT_CLAUDE_CODE_MODEL = "claude-opus-4-8";
/** Default thinking/effort level when the call doesn't override it. */
export const DEFAULT_CLAUDE_CODE_EFFORT = "high";
/** The binary to launch. Resolved off PATH. */
const CLAUDE_BINARY = "claude";

const claudeCodeSchema = Type.Object({
	prompt: Type.String({
		description:
			"The full, self-contained task for Claude Code to carry out. It runs in the project directory and can read, edit, and run commands, with no memory of this conversation — so include everything it needs to know.",
	}),
	cwd: Type.Optional(
		Type.String({
			description:
				"Subdirectory (relative to the project root) to run Claude Code in. Defaults to the project root.",
		}),
	),
	model: Type.Optional(
		Type.String({
			description: `Model for Claude Code to use (a Claude model id or alias). Defaults to ${DEFAULT_CLAUDE_CODE_MODEL}.`,
		}),
	),
	effort: Type.Optional(
		Type.Union(
			[
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("xhigh"),
				Type.Literal("max"),
			],
			{
				description: `Thinking/effort level for Claude Code. Defaults to ${DEFAULT_CLAUDE_CODE_EFFORT}. Raise to xhigh/max for very hard tasks, lower to save usage.`,
			},
		),
	),
	max_turns: Type.Optional(
		Type.Number({
			description: "Cap Claude Code at this many agent turns. Default: unlimited (it runs the task to completion).",
		}),
	),
	add_dirs: Type.Optional(
		Type.Array(Type.String(), {
			description: "Extra directories Claude Code is allowed to access, beyond its working directory.",
		}),
	),
	append_system_prompt: Type.Optional(
		Type.String({
			description: "Extra instructions appended to Claude Code's default system prompt for this run.",
		}),
	),
	timeout_seconds: Type.Optional(
		Type.Number({
			description: `Kill Claude Code if it runs longer than this many seconds. Default: ${DEFAULT_CLAUDE_CODE_TIMEOUT_SECONDS}.`,
		}),
	),
});

export type ClaudeCodeToolInput = Static<typeof claudeCodeSchema>;

export interface ClaudeCodeToolDetails {
	status: "ok" | "error" | "aborted";
	/** Process exit code, or null when killed/aborted. */
	exitCode: number | null;
	/** Agent turns Claude Code took, when reported. */
	numTurns?: number;
	/** Dollar cost of the run, when reported. */
	costUsd?: number;
	/** Claude Code session id, for resuming/debugging. */
	sessionId?: string;
	/** Wall-clock duration in ms. */
	durationMs?: number;
}

/** Shape of the `--output-format json` result object Claude Code prints. */
interface ClaudeJsonResult {
	type?: string;
	subtype?: string;
	is_error?: boolean;
	result?: string;
	num_turns?: number;
	total_cost_usd?: number;
	session_id?: string;
	duration_ms?: number;
}

interface ClaudeRunOutcome {
	stdout: string;
	stderr: string;
	code: number | null;
	spawnError?: Error;
	timedOut: boolean;
}

/** Launch the claude binary directly (no shell) and collect its output. Never throws. */
function runClaudeCli(
	args: string[],
	workdir: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<ClaudeRunOutcome> {
	return new Promise((resolveRun) => {
		const child = spawnProcess(CLAUDE_BINARY, args, {
			cwd: workdir,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const timer =
			timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						if (child.pid) {
							killProcessTree(child.pid);
						}
					}, timeoutMs)
				: undefined;

		const onAbort = () => {
			if (child.pid) {
				killProcessTree(child.pid);
			}
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		const finish = (outcome: ClaudeRunOutcome) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			signal?.removeEventListener("abort", onAbort);
			resolveRun(outcome);
		};

		child.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("error", (err: Error) => {
			finish({ stdout, stderr, code: null, spawnError: err, timedOut });
		});
		child.on("close", (code: number | null) => {
			finish({ stdout, stderr, code, timedOut });
		});
	});
}

/** Pull the JSON result object out of Claude Code's stdout, tolerating stray lines. */
function parseClaudeJson(stdout: string): ClaudeJsonResult | undefined {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return undefined;
	}
	// Fast path: the whole output is the JSON object.
	try {
		return JSON.parse(trimmed) as ClaudeJsonResult;
	} catch {
		// Fall back to the last brace-delimited block (in case of leading noise).
	}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed.slice(start, end + 1)) as ClaudeJsonResult;
	} catch {
		return undefined;
	}
}

export function createClaudeCodeToolDefinition(
	cwd: string,
): ToolDefinition<typeof claudeCodeSchema, ClaudeCodeToolDetails> {
	return {
		name: "claude_code",
		label: "claude code",
		description:
			"Delegate a coding task to the official Claude Code CLI as a subagent. It runs headless in the project " +
			"directory with permissions bypassed, so it can read, edit files, and run commands to actually complete the " +
			"task, then returns its result. Runs Opus 4.8 at high thinking by default (override with model/effort). Claude " +
			"Code uses its own auth/subscription (separate from your model and billed separately). Give one self-contained " +
			"task per call; it has no memory of this conversation. Use it to hand off heavy or self-contained coding work.",
		promptSnippet: "Delegate a task to Claude Code",
		promptGuidelines: [
			"Use claude_code to hand a heavy, self-contained coding task to the Claude Code CLI; include all context it needs since it can't see this conversation.",
		],
		parameters: claudeCodeSchema,
		async execute(_toolCallId, params, signal, onUpdate) {
			const prompt = params.prompt?.trim();
			if (!prompt) {
				return {
					content: [{ type: "text", text: "claude_code: a non-empty prompt is required." }],
					details: { status: "error", exitCode: null },
				};
			}
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "claude_code: aborted before launch." }],
					details: { status: "aborted", exitCode: null },
				};
			}

			const workdir = params.cwd ? resolve(cwd, params.cwd) : cwd;
			const timeoutMs =
				Math.max(0, Math.floor(params.timeout_seconds ?? DEFAULT_CLAUDE_CODE_TIMEOUT_SECONDS)) * 1000;

			const model = params.model?.trim() || DEFAULT_CLAUDE_CODE_MODEL;
			const effort = params.effort ?? DEFAULT_CLAUDE_CODE_EFFORT;
			const args = ["-p", prompt, "--output-format", "json", "--permission-mode", "bypassPermissions"];
			args.push("--model", model);
			args.push("--effort", effort);
			if (params.max_turns && params.max_turns > 0) {
				args.push("--max-turns", String(Math.floor(params.max_turns)));
			}
			for (const dir of params.add_dirs ?? []) {
				if (dir.trim()) {
					args.push("--add-dir", dir);
				}
			}
			if (params.append_system_prompt?.trim()) {
				args.push("--append-system-prompt", params.append_system_prompt);
			}

			onUpdate?.({
				content: [{ type: "text", text: "claude_code: delegating to Claude Code…" }],
				details: { status: "ok", exitCode: null },
			});

			const started = Date.now();
			const outcome = await runClaudeCli(args, workdir, timeoutMs, signal);
			const fallbackDuration = Date.now() - started;

			// Spawn failure (most commonly: the claude binary isn't on PATH).
			if (outcome.spawnError) {
				const isMissing = (outcome.spawnError as NodeJS.ErrnoException).code === "ENOENT";
				const msg = isMissing
					? "claude_code: the `claude` CLI was not found on PATH. Install Claude Code or ensure `claude` is runnable."
					: `claude_code: failed to launch claude — ${outcome.spawnError.message}`;
				return { content: [{ type: "text", text: msg }], details: { status: "error", exitCode: null } };
			}
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "claude_code: aborted." }],
					details: { status: "aborted", exitCode: outcome.code, durationMs: fallbackDuration },
				};
			}
			if (outcome.timedOut) {
				return {
					content: [
						{
							type: "text",
							text: `claude_code: timed out after ${Math.round(timeoutMs / 1000)}s and was killed.`,
						},
					],
					details: { status: "error", exitCode: outcome.code, durationMs: fallbackDuration },
				};
			}

			const parsed = parseClaudeJson(outcome.stdout);
			const hardFailed = outcome.code !== 0 || parsed?.is_error || parsed?.subtype === "error_max_turns";

			if (hardFailed && !parsed?.result) {
				const detail = outcome.stderr.trim() || outcome.stdout.trim() || `exit code ${outcome.code}`;
				return {
					content: [{ type: "text", text: `claude_code: run failed.\n${detail}` }],
					details: {
						status: "error",
						exitCode: outcome.code,
						durationMs: parsed?.duration_ms ?? fallbackDuration,
					},
				};
			}

			// Prefer the structured result; fall back to raw stdout if JSON was absent.
			const resultText = (parsed?.result ?? outcome.stdout).trim() || "(Claude Code returned no output)";
			const status: ClaudeCodeToolDetails["status"] = hardFailed ? "error" : "ok";
			return {
				content: [{ type: "text", text: resultText }],
				details: {
					status,
					exitCode: outcome.code,
					numTurns: parsed?.num_turns,
					costUsd: parsed?.total_cost_usd,
					sessionId: parsed?.session_id,
					durationMs: parsed?.duration_ms ?? fallbackDuration,
				},
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const prompt = typeof args?.prompt === "string" ? args.prompt : "";
			const preview = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
			text.setText(`${theme.fg("toolTitle", theme.bold("claude_code"))} ${theme.fg("accent", preview || "task")}`);
			return text;
		},
		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details;
			if (!details) {
				text.setText(theme.fg("toolOutput", "claude_code: done"));
				return text;
			}
			const statusLabel = statusColor(details.status, theme);
			const bits: string[] = [statusLabel];
			if (details.numTurns !== undefined) {
				bits.push(theme.fg("muted", `${details.numTurns} turn${details.numTurns === 1 ? "" : "s"}`));
			}
			if (details.costUsd !== undefined) {
				bits.push(theme.fg("muted", `$${details.costUsd.toFixed(4)}`));
			}
			if (details.durationMs !== undefined) {
				bits.push(theme.fg("muted", `${(details.durationMs / 1000).toFixed(1)}s`));
			}
			text.setText(`${theme.fg("toolTitle", "claude_code")} ${bits.join(" ")}`);
			return text;
		},
	};
}

function statusColor(status: ClaudeCodeToolDetails["status"], theme: Theme): string {
	if (status === "ok") {
		return theme.fg("success", "ok");
	}
	if (status === "aborted") {
		return theme.fg("warning", "aborted");
	}
	return theme.fg("error", "error");
}

export function createClaudeCodeTool(cwd: string): AgentTool<typeof claudeCodeSchema> {
	return wrapToolDefinition(createClaudeCodeToolDefinition(cwd));
}
