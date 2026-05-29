import { existsSync } from "node:fs";
import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	abortProcessTask,
	formatProcessTaskListText,
	formatProcessTaskStatusText,
	getProcessTaskStatus,
	listProcessTasks,
	type ProcessTaskSummary,
	startBackgroundProcess,
} from "../process-tasks.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const processSchema = Type.Object({
	command: Type.Optional(Type.String({ description: "Shell command to run in the background" })),
	action: Type.Optional(
		Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("list"), Type.Literal("abort")], {
			description: "Process action (default: start when command is provided, otherwise status/list)",
		}),
	),
	taskId: Type.Optional(Type.String({ description: "Background task ID for status or abort" })),
	notify: Type.Optional(
		Type.Boolean({
			description: "Notify the agent when the process completes or fails (default: true for start)",
		}),
	),
	timeout: Type.Optional(Type.Number({ description: "Kill the process after this many seconds (optional)" })),
});

export type ProcessToolInput = Static<typeof processSchema>;

export interface ProcessToolDetails {
	action: ProcessToolInput["action"] | "start" | "status" | "list" | "abort";
	taskId?: string;
	command?: string;
	status?: ProcessTaskSummary["status"];
	pid?: number;
	exitCode?: number | null;
	tasks?: ProcessTaskSummary[];
}

export interface ProcessToolOptions {
	commandPrefix?: string;
	shellPath?: string;
}

export function createProcessToolDefinition(
	cwd: string,
	options?: ProcessToolOptions,
): ToolDefinition<typeof processSchema, ProcessToolDetails> {
	return {
		name: "process",
		label: "process",
		description:
			"Run shell commands in the background without blocking. Returns a task ID immediately and notifies the agent when the process completes or fails. Use bash for foreground commands that should finish in the same tool call.",
		promptSnippet: "Run background shell commands; agent is notified on completion",
		promptGuidelines: [
			"Use process for long-running commands (servers, installs, builds, downloads via shell) instead of polling bash output.",
			"Do not poll process action=status unless notification was missed; background tasks notify on completion by default.",
			"Use bash for quick synchronous commands.",
		],
		executionMode: "sequential",
		parameters: processSchema,

		async execute(_toolCallId, args) {
			const action = args.action || (args.command ? "start" : args.taskId ? "status" : "list");

			if (action === "list") {
				const tasks = listProcessTasks();
				return {
					content: [{ type: "text", text: formatProcessTaskListText(tasks) }],
					details: { action, tasks },
				};
			}

			if (action === "status") {
				if (!args.taskId) {
					throw new Error("taskId is required for status action.");
				}
				const task = getProcessTaskStatus(args.taskId);
				return {
					content: [{ type: "text", text: formatProcessTaskStatusText(task) }],
					details: {
						action,
						taskId: task.taskId,
						command: task.command,
						status: task.status,
						pid: task.pid,
						exitCode: task.exitCode,
					},
				};
			}

			if (action === "abort") {
				if (!args.taskId) {
					throw new Error("taskId is required for abort action.");
				}
				const task = abortProcessTask(args.taskId);
				return {
					content: [{ type: "text", text: `Aborted background process ${args.taskId}.` }],
					details: {
						action,
						taskId: task.taskId,
						command: task.command,
						status: task.status,
						pid: task.pid,
						exitCode: task.exitCode,
					},
				};
			}

			if (!args.command?.trim()) {
				throw new Error("command is required for start action.");
			}
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot start background process.`);
			}

			const command = options?.commandPrefix ? `${options.commandPrefix}\n${args.command}` : args.command;
			const task = startBackgroundProcess({
				command,
				cwd,
				notify: args.notify ?? true,
				timeout: args.timeout,
				shellPath: options?.shellPath,
			});

			return {
				content: [
					{
						type: "text",
						text: [
							"Background process started.",
							`Task ID: ${task.taskId}`,
							`Command: ${command}`,
							args.notify === false
								? "Notification disabled. Use process action=status to check completion."
								: "The agent will be notified automatically when this process completes or fails.",
						].join("\n"),
					},
				],
				details: {
					action: "start",
					taskId: task.taskId,
					command,
					status: task.status,
					pid: task.pid,
				},
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const action = args?.action ?? (args?.command ? "start" : "process");
			const target = args?.command || args?.taskId || "";
			const preview = target.length > 48 ? `${target.slice(0, 48)}...` : target.length > 0 ? target : undefined;
			text.setText(
				`${theme.fg("toolTitle", theme.bold("process"))} ${theme.fg("accent", action)}${preview ? ` ${theme.fg("muted", preview)}` : ""}`,
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as ProcessToolDetails | undefined;
			if (context.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("warning", msg.slice(0, 120)));
			} else if (options.isPartial) {
				text.setText(theme.fg("muted", "Starting background process..."));
			} else if (details?.action === "list") {
				text.setText(theme.fg("toolOutput", `${details.tasks?.length ?? 0} task(s)`));
			} else {
				const output = result.content[0]?.type === "text" ? result.content[0].text : "";
				const firstLine = output.split("\n")[0] ?? "";
				text.setText(theme.fg("toolOutput", firstLine));
			}
			return text;
		},
	};
}

export function createProcessTool(cwd: string, options?: ProcessToolOptions): AgentTool<typeof processSchema> {
	return wrapToolDefinition(createProcessToolDefinition(cwd, options));
}
