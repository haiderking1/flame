import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "../config.ts";
import { getShellConfig, getShellEnv, killProcessTree, trackDetachedChildPid } from "../utils/shell.ts";
import { DEFAULT_MAX_BYTES, truncateTail } from "./tools/truncate.ts";

export type ProcessTaskStatus = "running" | "success" | "failed" | "aborted" | "timeout";

export interface ProcessTaskMeta {
	taskId: string;
	command: string;
	cwd: string;
	status: ProcessTaskStatus;
	pid: number;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	startedAt: number;
	finishedAt?: number;
	notify: boolean;
	notified?: boolean;
}

export interface ProcessTaskSummary {
	taskId: string;
	command: string;
	cwd: string;
	status: ProcessTaskStatus;
	pid: number;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	startedAt: number;
	finishedAt?: number;
	logTail?: string;
}

export interface ProcessTaskCompletion extends ProcessTaskSummary {
	notify: boolean;
}

export interface StartBackgroundProcessOptions {
	command: string;
	cwd: string;
	notify?: boolean;
	timeout?: number;
	shellPath?: string;
}

export type ProcessTaskCompletionHandler = (completion: ProcessTaskCompletion) => void | Promise<void>;

const activeWatchers = new Map<string, ChildProcess>();
let completionHandler: ProcessTaskCompletionHandler | undefined;

export function getProcessesDir(): string {
	return path.join(getAgentDir(), "processes");
}

export function setProcessTaskCompletionHandler(handler: ProcessTaskCompletionHandler | undefined): void {
	completionHandler = handler;
}

export function clearProcessTaskWatchers(): void {
	activeWatchers.clear();
}

function isProcessRunning(pid: number): boolean {
	if (!pid) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readProcessTaskMeta(metaPath: string): ProcessTaskMeta {
	return JSON.parse(readFileSync(metaPath, "utf-8")) as ProcessTaskMeta;
}

function writeProcessTaskMeta(tasksDir: string, meta: ProcessTaskMeta): void {
	writeFileSync(path.join(tasksDir, `${meta.taskId}.json`), JSON.stringify(meta, null, 2));
}

function readLogTail(tasksDir: string, taskId: string): string | undefined {
	const logPath = path.join(tasksDir, `${taskId}.log`);
	if (!existsSync(logPath)) {
		return undefined;
	}
	const raw = readFileSync(logPath, "utf-8");
	if (raw.length === 0) {
		return undefined;
	}
	const truncated = truncateTail(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: 200 });
	return truncated.content.trimEnd() || undefined;
}

function inferFinishedStatus(exitCode: number | null, signal: NodeJS.Signals | null): ProcessTaskStatus {
	if (signal === "SIGTERM" || signal === "SIGKILL") {
		return "aborted";
	}
	if (exitCode === 0) {
		return "success";
	}
	return "failed";
}

function toSummary(meta: ProcessTaskMeta, tasksDir: string, includeLogTail: boolean): ProcessTaskSummary {
	return {
		taskId: meta.taskId,
		command: meta.command,
		cwd: meta.cwd,
		status: meta.status,
		pid: meta.pid,
		exitCode: meta.exitCode,
		signal: meta.signal,
		startedAt: meta.startedAt,
		finishedAt: meta.finishedAt,
		logTail: includeLogTail ? readLogTail(tasksDir, meta.taskId) : undefined,
	};
}

function finalizeTask(
	tasksDir: string,
	meta: ProcessTaskMeta,
	exitCode: number | null,
	signal: NodeJS.Signals | null,
	forceStatus?: ProcessTaskStatus,
): ProcessTaskSummary {
	meta.exitCode = exitCode;
	meta.signal = signal;
	meta.finishedAt = Date.now();
	meta.status = forceStatus ?? inferFinishedStatus(exitCode, signal);
	writeProcessTaskMeta(tasksDir, meta);
	activeWatchers.delete(meta.taskId);

	const summary = toSummary(meta, tasksDir, true);
	if (meta.notify && !meta.notified && completionHandler) {
		meta.notified = true;
		writeProcessTaskMeta(tasksDir, meta);
		void Promise.resolve(
			completionHandler({
				...summary,
				notify: true,
			}),
		).catch(() => {
			// Notification failures should not crash the watcher.
		});
	}
	return summary;
}

function attachProcessWatcher(tasksDir: string, meta: ProcessTaskMeta, child: ChildProcess, timeout?: number): void {
	activeWatchers.set(meta.taskId, child);

	let timeoutHandle: NodeJS.Timeout | undefined;
	if (timeout !== undefined && timeout > 0) {
		timeoutHandle = setTimeout(() => {
			if (child.pid) {
				killProcessTree(child.pid);
			}
		}, timeout * 1000);
	}

	child.on("exit", (exitCode, signal) => {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
		if (child.pid) {
			// Background tasks manage their own lifecycle; do not untrack here because
			// shutdown cleanup may still need to find detached descendants.
		}
		try {
			const currentMeta = readProcessTaskMeta(path.join(tasksDir, `${meta.taskId}.json`));
			if (currentMeta.status !== "running") {
				return;
			}
			finalizeTask(tasksDir, currentMeta, exitCode, signal, timeoutHandle && signal ? "timeout" : undefined);
		} catch {
			// Meta file may have been deleted manually.
		}
	});

	child.on("error", () => {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
		try {
			const currentMeta = readProcessTaskMeta(path.join(tasksDir, `${meta.taskId}.json`));
			if (currentMeta.status !== "running") {
				return;
			}
			finalizeTask(tasksDir, currentMeta, 1, null, "failed");
		} catch {
			// ignore missing meta
		}
	});
}

export function summarizeProcessTask(meta: ProcessTaskMeta, tasksDir: string, persist: boolean): ProcessTaskSummary {
	const running = isProcessRunning(meta.pid);
	if (running) {
		return toSummary(meta, tasksDir, false);
	}

	if (meta.status === "running") {
		const logContent = existsSync(path.join(tasksDir, `${meta.taskId}.log`))
			? readFileSync(path.join(tasksDir, `${meta.taskId}.log`), "utf-8")
			: "";
		meta.status = inferFinishedStatus(meta.exitCode, meta.signal);
		if (meta.status === "failed" && logContent.length === 0 && meta.exitCode === null) {
			meta.status = "failed";
		}
		meta.finishedAt = meta.finishedAt ?? Date.now();
		if (persist) {
			writeProcessTaskMeta(tasksDir, meta);
		}
	}

	return toSummary(meta, tasksDir, meta.status !== "running");
}

export function startBackgroundProcess(options: StartBackgroundProcessOptions): ProcessTaskSummary {
	const tasksDir = getProcessesDir();
	if (!existsSync(tasksDir)) {
		mkdirSync(tasksDir, { recursive: true });
	}

	const taskId = `proc_${Date.now()}`;
	const logPath = path.join(tasksDir, `${taskId}.log`);
	const notify = options.notify ?? true;
	const meta: ProcessTaskMeta = {
		taskId,
		command: options.command,
		cwd: options.cwd,
		status: "running",
		pid: 0,
		exitCode: null,
		signal: null,
		startedAt: Date.now(),
		notify,
		notified: false,
	};
	writeProcessTaskMeta(tasksDir, meta);

	const logFd = openSync(logPath, "w");
	const { shell, args } = getShellConfig(options.shellPath);
	const child = spawn(shell, [...args, options.command], {
		cwd: options.cwd,
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: getShellEnv(),
		windowsHide: true,
	});
	closeSync(logFd);

	if (child.pid) {
		trackDetachedChildPid(child.pid);
		meta.pid = child.pid;
		writeProcessTaskMeta(tasksDir, meta);
	}

	attachProcessWatcher(tasksDir, meta, child, options.timeout);
	child.unref();

	return toSummary(meta, tasksDir, false);
}

export function listProcessTasks(): ProcessTaskSummary[] {
	const tasksDir = getProcessesDir();
	if (!existsSync(tasksDir)) {
		return [];
	}

	const tasks: ProcessTaskSummary[] = [];
	for (const file of readdirSync(tasksDir)) {
		if (!file.endsWith(".json")) {
			continue;
		}
		try {
			const meta = readProcessTaskMeta(path.join(tasksDir, file));
			tasks.push(summarizeProcessTask(meta, tasksDir, true));
		} catch {
			// ignore invalid metadata
		}
	}
	return tasks.sort((a, b) => b.startedAt - a.startedAt);
}

export function getProcessTaskStatus(taskId: string): ProcessTaskSummary {
	const tasksDir = getProcessesDir();
	const metaPath = path.join(tasksDir, `${taskId}.json`);
	if (!existsSync(metaPath)) {
		throw new Error(`Task ${taskId} not found.`);
	}
	const meta = readProcessTaskMeta(metaPath);
	return summarizeProcessTask(meta, tasksDir, true);
}

export function abortProcessTask(taskId: string): ProcessTaskSummary {
	const tasksDir = getProcessesDir();
	const metaPath = path.join(tasksDir, `${taskId}.json`);
	if (!existsSync(metaPath)) {
		throw new Error(`Task ${taskId} not found.`);
	}

	const meta = readProcessTaskMeta(metaPath);
	if (meta.status !== "running") {
		return summarizeProcessTask(meta, tasksDir, true);
	}

	if (meta.pid) {
		try {
			killProcessTree(meta.pid);
		} catch {
			// ignore
		}
	}

	const watcher = activeWatchers.get(taskId);
	if (watcher && !watcher.killed && watcher.pid) {
		try {
			killProcessTree(watcher.pid);
		} catch {
			// ignore
		}
	}

	return finalizeTask(tasksDir, meta, meta.exitCode, "SIGTERM", "aborted");
}

export function formatProcessTaskCompletionMessage(completion: ProcessTaskCompletion): string {
	const lines = [
		`Background process ${completion.taskId} finished with status: ${completion.status}.`,
		`Command: ${completion.command}`,
		`Working directory: ${completion.cwd}`,
	];
	if (completion.exitCode !== null) {
		lines.push(`Exit code: ${completion.exitCode}`);
	}
	if (completion.signal) {
		lines.push(`Signal: ${completion.signal}`);
	}
	if (completion.logTail) {
		lines.push("", "Output tail:", completion.logTail);
	} else {
		lines.push("", "No output captured.");
	}
	lines.push("", "Use process action=status if you need the full saved log.");
	return lines.join("\n");
}

export function formatProcessTaskListText(tasks: ProcessTaskSummary[]): string {
	if (tasks.length === 0) {
		return "Background Process Tasks:\nNo tasks found.";
	}

	const lines = ["Background Process Tasks:"];
	for (const task of tasks) {
		lines.push("");
		lines.push(`Task ID: ${task.taskId}`);
		lines.push(`Status: ${task.status}`);
		lines.push(`Command: ${task.command}`);
		lines.push(`CWD: ${task.cwd}`);
		if (task.exitCode !== null) {
			lines.push(`Exit code: ${task.exitCode}`);
		}
	}
	return lines.join("\n");
}

export function formatProcessTaskStatusText(task: ProcessTaskSummary): string {
	const lines = [
		`Process Task Status: ${task.taskId}`,
		`Status: ${task.status}`,
		`Command: ${task.command}`,
		`Working directory: ${task.cwd}`,
		`PID: ${task.pid}`,
	];
	if (task.exitCode !== null) {
		lines.push(`Exit code: ${task.exitCode}`);
	}
	if (task.signal) {
		lines.push(`Signal: ${task.signal}`);
	}
	if (task.logTail) {
		lines.push("", "Output tail:", task.logTail);
	}
	return lines.join("\n");
}
