/**
 * tnr — drive Thunder Compute cloud GPU instances for the model.
 *
 * One action-based tool that wraps the official `tnr` CLI plus SSH so the model
 * can run a full remote-training loop: list/create/delete instances, run shell
 * commands ON an instance, and move files to/from it. Every action returns the
 * remote/CLI **stdout, stderr, and exit code** cleanly.
 *
 * Actions:
 *   status                              -> `tnr status --no-wait`
 *   create   {args?}                    -> `tnr create <args…>`
 *   delete   {instance}                 -> `tnr delete <instance>`
 *   run      {instance, command, cwd?}  -> `ssh tnr-<instance> "[cd cwd &&] command"`
 *   upload   {instance, local, remote}  -> `tnr scp <local> <instance>:<remote>`
 *   download {instance, remote, local}  -> `tnr scp <instance>:<remote> <local>`
 *   cli      {args}                      -> `tnr <args…>` (escape hatch: modify, snapshot, ports, ssh-keys…)
 *
 * How it execs: the `tnr` binary and `ssh` are launched *directly* with an
 * argument array (no shell), so there's no quoting/injection risk on the local
 * side. The `run` action's `command` string is handed to the *remote* shell by
 * ssh, exactly like typing it on the instance.
 *
 * Remote `run` uses the SSH host alias `tnr-<id>` that `tnr connect <id>` writes
 * to ~/.ssh/config. If you've never connected to the instance, that alias won't
 * exist yet — the tool detects this and tells you to run `tnr connect <id>` once
 * in a terminal (it also sets up keys/auth). Auth otherwise comes from the
 * machine's Thunder login (`tnr login`) or TNR_API_TOKEN; this tool never logs in.
 *
 * Note: Thunder Compute has no native stop/start (pause). To "stop" an instance
 * you snapshot then delete it (`cli ["snapshot","create",…]` + `delete`), and to
 * "start" you restore the snapshot — there is no in-place pause to wrap.
 */
import type { AgentTool } from "@earendil-works/flame-agent-core";
import { StringEnum } from "@earendil-works/flame-ai";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { spawnProcess } from "../../utils/child-process.ts";
import { killProcessTree } from "../../utils/shell.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/** Default wall-clock cap for one action. Override per-call for long training runs. */
export const DEFAULT_TNR_TIMEOUT_SECONDS = 600;
const TNR_BINARY = "tnr";
const SSH_BINARY = "ssh";

const tnrSchema = Type.Object({
	action: StringEnum(["status", "run", "upload", "download", "create", "delete", "cli"] as const, {
		description:
			"What to do: status (list instances), run (shell command on the instance), upload/download (copy files), " +
			"create/delete (instance lifecycle), cli (raw `tnr` passthrough for modify/snapshot/ports/ssh-keys).",
	}),
	instance: Type.Optional(
		Type.String({
			description:
				"Instance id (from `status`) for run/upload/download/delete. Optional: if you have exactly one instance it's auto-detected, so you can omit it. Pass it explicitly when you have multiple.",
		}),
	),
	command: Type.Optional(
		Type.String({
			description:
				"For run: the shell command to execute ON the instance, e.g. 'nvidia-smi' or 'python train.py --epochs 3'.",
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description:
				"For run: remote working directory to cd into before running command (e.g. '/root/job'). Default: the instance's login dir.",
		}),
	),
	local: Type.Optional(
		Type.String({
			description:
				"For upload/download: the local path (relative to the project, or absolute). upload reads it; download writes it.",
		}),
	),
	remote: Type.Optional(
		Type.String({
			description: "For upload/download: the path on the instance, e.g. '/root/train.jsonl' or '/root/adapter/'.",
		}),
	),
	args: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"For create/cli: extra `tnr` argument tokens, each a separate element, e.g. ['--gpu','a100','--vcpus','8'].",
		}),
	),
	timeout_seconds: Type.Optional(
		Type.Number({
			description: `Kill the action if it runs longer than this many seconds. Default: ${DEFAULT_TNR_TIMEOUT_SECONDS}. Raise it for long training runs.`,
		}),
	),
});

export type TnrToolInput = Static<typeof tnrSchema>;
export type TnrAction = TnrToolInput["action"];

export interface TnrToolDetails {
	action: TnrAction;
	status: "ok" | "error" | "aborted";
	instance?: string;
	/** Process/remote exit code, or null when killed/aborted/spawn-failed. */
	exitCode: number | null;
	stdout?: string;
	stderr?: string;
	durationMs?: number;
}

interface RunOutcome {
	stdout: string;
	stderr: string;
	code: number | null;
	spawnError?: Error;
	timedOut: boolean;
}

/** Launch a binary directly (no shell) and collect its output. Never throws. */
function runProcess(
	binary: string,
	args: string[],
	workdir: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<RunOutcome> {
	return new Promise((resolveRun) => {
		const child = spawnProcess(binary, args, {
			cwd: workdir,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1" },
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const timer =
			timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeoutMs)
				: undefined;

		const onAbort = () => {
			if (child.pid) killProcessTree(child.pid);
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		const finish = (outcome: RunOutcome) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolveRun(outcome);
		};

		child.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		child.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		child.on("error", (err: Error) => finish({ stdout, stderr, code: null, spawnError: err, timedOut }));
		child.on("close", (code: number | null) => finish({ stdout, stderr, code, timedOut }));
	});
}

/** Single quote a string for a POSIX remote shell (for the `cd` in run). */
function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Render stdout/stderr/exit-code into one clean text block. */
function formatOutput(outcome: RunOutcome, label: string): string {
	const parts: string[] = [`${label} — exit code: ${outcome.code}`];
	const out = outcome.stdout.trim();
	const err = outcome.stderr.trim();
	if (out) parts.push(`\nstdout:\n${out}`);
	if (err) parts.push(`\nstderr:\n${err}`);
	if (!out && !err) parts.push("\n(no output)");
	return parts.join("\n");
}

/** Build [binary, args, label] for an action, or return an error string if params are missing. */
function planAction(params: TnrToolInput): { binary: string; args: string[]; label: string } | { error: string } {
	const need = (field: keyof TnrToolInput, what: string): string | undefined =>
		params[field] ? undefined : `tnr: "${params.action}" requires "${field}" (${what}).`;

	switch (params.action) {
		case "status":
			return { binary: TNR_BINARY, args: ["status", "--no-wait"], label: "tnr status" };
		case "create":
			return { binary: TNR_BINARY, args: ["create", ...(params.args ?? [])], label: "tnr create" };
		case "cli": {
			const args = (params.args ?? []).filter((a) => a.length > 0);
			if (args.length === 0) return { error: 'tnr: "cli" requires a non-empty "args" array.' };
			return { binary: TNR_BINARY, args, label: `tnr ${args[0]}` };
		}
		case "delete": {
			const miss = need("instance", "instance id");
			if (miss) return { error: miss };
			return { binary: TNR_BINARY, args: ["delete", params.instance as string], label: "tnr delete" };
		}
		case "upload": {
			const miss = need("instance", "instance id") ?? need("local", "local path") ?? need("remote", "remote path");
			if (miss) return { error: miss };
			return {
				binary: TNR_BINARY,
				args: ["scp", params.local as string, `${params.instance}:${params.remote}`],
				label: "tnr upload",
			};
		}
		case "download": {
			const miss = need("instance", "instance id") ?? need("remote", "remote path") ?? need("local", "local path");
			if (miss) return { error: miss };
			return {
				binary: TNR_BINARY,
				args: ["scp", `${params.instance}:${params.remote}`, params.local as string],
				label: "tnr download",
			};
		}
		case "run": {
			const miss = need("instance", "instance id") ?? need("command", "command to run");
			if (miss) return { error: miss };
			const remote = params.cwd ? `cd ${shellQuote(params.cwd)} && ${params.command}` : (params.command as string);
			return {
				binary: SSH_BINARY,
				args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", `tnr-${params.instance}`, remote],
				label: "tnr run",
			};
		}
	}
}

/** Actions that operate on a specific instance and can auto-resolve the sole one. */
const ACTIONS_NEEDING_INSTANCE = new Set<TnrAction>(["run", "upload", "download", "delete"]);
/** Candidate id fields in `tnr status --json`, in the order the CLI accepts. */
const INSTANCE_ID_FIELDS = ["id", "uuid", "instanceId", "instance_id"] as const;

function pickInstanceId(obj: unknown): string | undefined {
	if (!obj || typeof obj !== "object") return undefined;
	const rec = obj as Record<string, unknown>;
	for (const f of INSTANCE_ID_FIELDS) {
		const v = rec[f];
		if (typeof v === "string" && v.length > 0) return v;
		if (typeof v === "number") return String(v);
	}
	return undefined;
}

/**
 * When `instance` is omitted, look it up from `tnr status --no-wait --json`.
 * Succeeds only when exactly one instance exists (the common single-box case);
 * otherwise returns a clear error telling the model to pass `instance`.
 */
async function resolveSoleInstance(
	workdir: string,
	signal: AbortSignal | undefined,
): Promise<{ instance: string } | { error: string }> {
	const outcome = await runProcess(TNR_BINARY, ["status", "--no-wait", "--json"], workdir, 60_000, signal);
	if (outcome.spawnError) {
		const isMissing = (outcome.spawnError as NodeJS.ErrnoException).code === "ENOENT";
		return {
			error: isMissing
				? "tnr: the `tnr` CLI was not found on PATH. Install the Thunder Compute CLI (`tnr`)."
				: `tnr: couldn't list instances to auto-pick one — ${outcome.spawnError.message}`,
		};
	}
	let list: unknown;
	try {
		// stdout is clean JSON; the "Fetching instances…" notice goes to stderr.
		list = JSON.parse(outcome.stdout.trim() || "[]");
	} catch {
		return { error: 'tnr: couldn\'t parse the instance list; pass "instance" explicitly.' };
	}
	if (!Array.isArray(list)) return { error: 'tnr: unexpected instance list; pass "instance" explicitly.' };
	if (list.length === 0) return { error: 'tnr: no instances exist — create one with action "create" first.' };
	const ids = list.map(pickInstanceId).filter((x): x is string => x !== undefined);
	if (list.length > 1) {
		return {
			error: `tnr: ${list.length} instances running (${ids.join(", ") || "unknown ids"}); pass "instance" explicitly.`,
		};
	}
	if (!ids[0]) return { error: 'tnr: couldn\'t determine the instance id; pass "instance" explicitly.' };
	return { instance: ids[0] };
}

export function createTnrToolDefinition(cwd: string): ToolDefinition<typeof tnrSchema, TnrToolDetails> {
	return {
		name: "tnr",
		label: "tnr",
		description:
			"Manage and use Thunder Compute cloud GPU instances. Actions: status (list instances), create / delete, " +
			"run (execute a shell command ON an instance — e.g. nvidia-smi, pip install, python train.py), upload / " +
			"download (copy files to/from the instance), and cli (raw `tnr` passthrough for modify/snapshot/ports). " +
			"Returns stdout, stderr, and exit code. run needs the instance to have been connected once via `tnr connect " +
			"<id>` in a terminal (sets up SSH/keys). Thunder has no pause/stop — snapshot+delete to stop, restore to start.",
		promptSnippet: "Manage Thunder Compute GPU instances and run remote commands / file transfers",
		promptGuidelines: [
			"Use tnr to drive Thunder Compute GPU instances: call status to get an instance id, then run/upload/download against it for remote training. run executes the command on the instance over SSH and is not for interactive sessions.",
		],
		parameters: tnrSchema,
		async execute(_toolCallId, params, signal, onUpdate) {
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "tnr: aborted before launch." }],
					details: { action: params.action, status: "aborted", exitCode: null, instance: params.instance },
				};
			}

			// Auto-pick the instance when omitted and there's exactly one (single-box workflow).
			let effective = params;
			if (ACTIONS_NEEDING_INSTANCE.has(params.action) && !params.instance) {
				const resolved = await resolveSoleInstance(cwd, signal);
				if ("error" in resolved) {
					return {
						content: [{ type: "text", text: resolved.error }],
						details: { action: params.action, status: "error", exitCode: null },
					};
				}
				effective = { ...params, instance: resolved.instance };
			}

			const plan = planAction(effective);
			if ("error" in plan) {
				return {
					content: [{ type: "text", text: plan.error }],
					details: { action: effective.action, status: "error", exitCode: null },
				};
			}

			const workdir = cwd;
			const timeoutSeconds = Math.max(0, Math.floor(params.timeout_seconds ?? DEFAULT_TNR_TIMEOUT_SECONDS));

			onUpdate?.({
				content: [{ type: "text", text: `${plan.label}…` }],
				details: { action: params.action, status: "ok", exitCode: null, instance: effective.instance },
			});

			const started = Date.now();
			const outcome = await runProcess(plan.binary, plan.args, workdir, timeoutSeconds * 1000, signal);
			const durationMs = Date.now() - started;

			if (outcome.spawnError) {
				const isMissing = (outcome.spawnError as NodeJS.ErrnoException).code === "ENOENT";
				const msg = isMissing
					? `tnr: \`${plan.binary}\` was not found on PATH. ${plan.binary === SSH_BINARY ? "Install an SSH client." : "Install the Thunder Compute CLI (`tnr`)."}`
					: `tnr: failed to launch ${plan.binary} — ${outcome.spawnError.message}`;
				return {
					content: [{ type: "text", text: msg }],
					details: { action: params.action, status: "error", exitCode: null, instance: params.instance },
				};
			}
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "tnr: aborted." }],
					details: {
						action: params.action,
						status: "aborted",
						exitCode: outcome.code,
						durationMs,
						instance: effective.instance,
					},
				};
			}
			if (outcome.timedOut) {
				return {
					content: [
						{ type: "text", text: `tnr: ${plan.label} timed out after ${timeoutSeconds}s and was killed.` },
					],
					details: {
						action: params.action,
						status: "error",
						exitCode: outcome.code,
						durationMs,
						instance: effective.instance,
					},
				};
			}

			// Detect the "never connected" case for run so the model knows the fix.
			if (
				params.action === "run" &&
				outcome.code === 255 &&
				/could not resolve hostname|name or service not known/i.test(outcome.stderr)
			) {
				return {
					content: [
						{
							type: "text",
							text: `tnr: no SSH alias "tnr-${effective.instance}" yet. Run \`tnr connect ${effective.instance}\` once in a terminal to set up SSH access, then retry.`,
						},
					],
					details: {
						action: "run",
						status: "error",
						exitCode: outcome.code,
						stderr: outcome.stderr,
						durationMs,
						instance: effective.instance,
					},
				};
			}

			const text = formatOutput(outcome, plan.label);
			return {
				content: [{ type: "text", text }],
				details: {
					action: params.action,
					status: outcome.code === 0 ? "ok" : "error",
					exitCode: outcome.code,
					stdout: outcome.stdout,
					stderr: outcome.stderr,
					durationMs,
					instance: params.instance,
				},
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const action = typeof args?.action === "string" ? args.action : "";
			const detail =
				typeof args?.command === "string" ? args.command : typeof args?.instance === "string" ? args.instance : "";
			const preview = detail.length > 50 ? `${detail.slice(0, 47)}…` : detail;
			text.setText(
				`${theme.fg("toolTitle", theme.bold("tnr"))} ${theme.fg("accent", action)}${preview ? ` ${theme.fg("muted", preview)}` : ""}`,
			);
			return text;
		},
		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details;
			if (!details) {
				text.setText(theme.fg("toolOutput", "tnr: done"));
				return text;
			}
			const bits: string[] = [statusColor(details.status, theme), theme.fg("muted", details.action)];
			if (details.exitCode !== null && details.exitCode !== undefined) {
				bits.push(theme.fg(details.exitCode === 0 ? "muted" : "error", `exit ${details.exitCode}`));
			}
			if (details.durationMs !== undefined) {
				bits.push(theme.fg("muted", `${(details.durationMs / 1000).toFixed(1)}s`));
			}
			text.setText(`${theme.fg("toolTitle", "tnr")} ${bits.join(" ")}`);
			return text;
		},
	};
}

function statusColor(status: TnrToolDetails["status"], theme: Theme): string {
	if (status === "ok") return theme.fg("success", "ok");
	if (status === "aborted") return theme.fg("warning", "aborted");
	return theme.fg("error", "error");
}

export function createTnrTool(cwd: string): AgentTool<typeof tnrSchema> {
	return wrapToolDefinition(createTnrToolDefinition(cwd));
}
