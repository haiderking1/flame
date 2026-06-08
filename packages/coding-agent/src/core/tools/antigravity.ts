/**
 * antigravity — delegate a task to Google's Antigravity agent CLI (`agy`) as a subagent.
 *
 * The main model hands a self-contained task to this tool, which launches the
 * official `agy` CLI in headless print mode
 * (`agy -p <task> --dangerously-skip-permissions --add-dir <project>`) anchored to
 * the project's git root, so the subagent can actually edit files and run commands.
 * Antigravity does the work and its printed response is returned to the main model.
 *
 * Like the claude_code tool, this execs the official `agy` binary *directly* with
 * an argument array — no shell, no token extraction. It runs on whatever auth the
 * user's Antigravity is logged into (its own subscription, separate from the flame
 * model). The model + thinking level are whatever is selected in the Antigravity
 * app — `agy` has no model flag, so it inherits that selection (e.g. Gemini Flash
 * at high thinking).
 *
 * IMPORTANT: `agy` anchors its workspace to a git project root. When the working
 * directory is not a git repo it falls back to its own scratch workspace and will
 * NOT touch the project — so this tool warns when cwd isn't a git repo.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { spawnProcess } from "../../utils/child-process.ts";
import { killProcessTree } from "../../utils/shell.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/** Default wall-clock cap for one delegated Antigravity run. */
export const DEFAULT_ANTIGRAVITY_TIMEOUT_SECONDS = 1800;
/** The binary to launch. Resolved off PATH. */
const AGY_BINARY = "agy";

const antigravitySchema = Type.Object({
	prompt: Type.String({
		description:
			"The full, self-contained task for Antigravity to carry out. It runs in the project (git) directory and can read, edit, and run commands, with no memory of this conversation — so include everything it needs to know.",
	}),
	cwd: Type.Optional(
		Type.String({
			description:
				"Subdirectory (relative to the project root) to run Antigravity in. Must be inside a git repo or Antigravity falls back to its scratch workspace and won't touch the project. Defaults to the project root.",
		}),
	),
	add_dirs: Type.Optional(
		Type.Array(Type.String(), {
			description: "Extra directories to add to Antigravity's workspace, beyond the working directory.",
		}),
	),
	sandbox: Type.Optional(
		Type.Boolean({
			description: "Run Antigravity in its restricted sandbox (terminal restrictions enabled). Default: false.",
		}),
	),
	timeout_seconds: Type.Optional(
		Type.Number({
			description: `Kill Antigravity if it runs longer than this many seconds. Default: ${DEFAULT_ANTIGRAVITY_TIMEOUT_SECONDS}.`,
		}),
	),
});

export type AntigravityToolInput = Static<typeof antigravitySchema>;

export interface AntigravityToolDetails {
	status: "ok" | "error" | "aborted";
	/** Process exit code, or null when killed/aborted. */
	exitCode: number | null;
	/** Wall-clock duration in ms. */
	durationMs?: number;
	/** True when the working directory wasn't a git repo (agy used its scratch workspace). */
	notGitRepo?: boolean;
}

interface AgyRunOutcome {
	stdout: string;
	stderr: string;
	code: number | null;
	spawnError?: Error;
	timedOut: boolean;
}

/** Launch the agy binary directly (no shell) and collect its output. Never throws. */
function runAgyCli(
	args: string[],
	workdir: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<AgyRunOutcome> {
	return new Promise((resolveRun) => {
		const child = spawnProcess(AGY_BINARY, args, {
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

		const finish = (outcome: AgyRunOutcome) => {
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

export function createAntigravityToolDefinition(
	cwd: string,
): ToolDefinition<typeof antigravitySchema, AntigravityToolDetails> {
	return {
		name: "antigravity",
		label: "antigravity",
		description:
			"Delegate a coding task to Google's Antigravity agent CLI (agy) as a subagent. It runs headless in the " +
			"project's git directory with permissions bypassed, so it can read, edit files, and run commands to actually " +
			"complete the task, then returns its response. Runs on the model selected in the Antigravity app (e.g. Gemini " +
			"Flash at high thinking) using its own auth/subscription, separate from your model. Give one self-contained " +
			"task per call; it has no memory of this conversation. The working directory must be a git repo or it won't " +
			"touch the project.",
		promptSnippet: "Delegate a task to Antigravity",
		promptGuidelines: [
			"Use antigravity to hand a self-contained coding task to Google's Antigravity (agy) CLI; it works in the git project and uses its own subscription. Include all context it needs since it can't see this conversation.",
		],
		parameters: antigravitySchema,
		async execute(_toolCallId, params, signal, onUpdate) {
			const prompt = params.prompt?.trim();
			if (!prompt) {
				return {
					content: [{ type: "text", text: "antigravity: a non-empty prompt is required." }],
					details: { status: "error", exitCode: null },
				};
			}
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "antigravity: aborted before launch." }],
					details: { status: "aborted", exitCode: null },
				};
			}

			const workdir = params.cwd ? resolve(cwd, params.cwd) : cwd;
			const notGitRepo = !existsSync(join(workdir, ".git"));
			const timeoutSeconds = Math.max(0, Math.floor(params.timeout_seconds ?? DEFAULT_ANTIGRAVITY_TIMEOUT_SECONDS));
			const timeoutMs = timeoutSeconds * 1000;

			const args = ["-p", prompt, "--dangerously-skip-permissions", "--add-dir", workdir];
			for (const dir of params.add_dirs ?? []) {
				if (dir.trim()) {
					args.push("--add-dir", resolve(workdir, dir));
				}
			}
			if (params.sandbox) {
				args.push("--sandbox");
			}
			if (timeoutSeconds > 0) {
				// Keep agy's own print-mode wait in sync with our wall-clock cap.
				args.push("--print-timeout", `${timeoutSeconds}s`);
			}

			onUpdate?.({
				content: [{ type: "text", text: "antigravity: delegating to Antigravity (agy)…" }],
				details: { status: "ok", exitCode: null, notGitRepo },
			});

			const started = Date.now();
			const outcome = await runAgyCli(args, workdir, timeoutMs, signal);
			const durationMs = Date.now() - started;

			if (outcome.spawnError) {
				const isMissing = (outcome.spawnError as NodeJS.ErrnoException).code === "ENOENT";
				const msg = isMissing
					? "antigravity: the `agy` CLI was not found on PATH. Install the Antigravity CLI (`agy`) or ensure it's runnable."
					: `antigravity: failed to launch agy — ${outcome.spawnError.message}`;
				return { content: [{ type: "text", text: msg }], details: { status: "error", exitCode: null } };
			}
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "antigravity: aborted." }],
					details: { status: "aborted", exitCode: outcome.code, durationMs },
				};
			}
			if (outcome.timedOut) {
				return {
					content: [{ type: "text", text: `antigravity: timed out after ${timeoutSeconds}s and was killed.` }],
					details: { status: "error", exitCode: outcome.code, durationMs },
				};
			}
			if (outcome.code !== 0) {
				const detail = outcome.stderr.trim() || outcome.stdout.trim() || `exit code ${outcome.code}`;
				return {
					content: [{ type: "text", text: `antigravity: run failed.\n${detail}` }],
					details: { status: "error", exitCode: outcome.code, durationMs, notGitRepo },
				};
			}

			// agy print mode emits the agent's final response as plain text on stdout.
			const body = outcome.stdout.trim() || "(Antigravity returned no output)";
			const warning = notGitRepo
				? "\n\n⚠️ Note: the working directory is not a git repo, so Antigravity worked in its own scratch workspace and likely did NOT modify the project."
				: "";
			return {
				content: [{ type: "text", text: body + warning }],
				details: { status: "ok", exitCode: outcome.code, durationMs, notGitRepo },
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const prompt = typeof args?.prompt === "string" ? args.prompt : "";
			const preview = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
			text.setText(`${theme.fg("toolTitle", theme.bold("antigravity"))} ${theme.fg("accent", preview || "task")}`);
			return text;
		},
		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details;
			if (!details) {
				text.setText(theme.fg("toolOutput", "antigravity: done"));
				return text;
			}
			const bits: string[] = [statusColor(details.status, theme)];
			if (details.durationMs !== undefined) {
				bits.push(theme.fg("muted", `${(details.durationMs / 1000).toFixed(1)}s`));
			}
			if (details.notGitRepo) {
				bits.push(theme.fg("warning", "not a git repo"));
			}
			text.setText(`${theme.fg("toolTitle", "antigravity")} ${bits.join(" ")}`);
			return text;
		},
	};
}

function statusColor(status: AntigravityToolDetails["status"], theme: Theme): string {
	if (status === "ok") {
		return theme.fg("success", "ok");
	}
	if (status === "aborted") {
		return theme.fg("warning", "aborted");
	}
	return theme.fg("error", "error");
}

export function createAntigravityTool(cwd: string): AgentTool<typeof antigravitySchema> {
	return wrapToolDefinition(createAntigravityToolDefinition(cwd));
}
