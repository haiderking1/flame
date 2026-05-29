import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	getShellConfig: vi.fn(() => ({ shell: "bash", args: ["-lc"] })),
	getShellEnv: vi.fn(() => process.env),
	trackDetachedChildPid: vi.fn(),
	killProcessTree: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawn: mocks.spawn,
}));

vi.mock("../src/utils/shell.ts", () => ({
	getShellConfig: mocks.getShellConfig,
	getShellEnv: mocks.getShellEnv,
	trackDetachedChildPid: mocks.trackDetachedChildPid,
	killProcessTree: mocks.killProcessTree,
}));

import {
	formatProcessTaskCompletionMessage,
	setProcessTaskCompletionHandler,
	summarizeProcessTask,
} from "../src/core/process-tasks.ts";
import { createProcessTool } from "../src/core/tools/process.ts";

function getTextOutput(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

describe("process tool", () => {
	const testDir = join(process.cwd(), "test-temp-process");
	const processTool = createProcessTool(testDir);

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
		mocks.spawn.mockReset();
		setProcessTaskCompletionHandler(undefined);
	});

	afterEach(() => {
		setProcessTaskCompletionHandler(undefined);
		vi.unstubAllEnvs();
	});

	it("starts a background process and returns a task id", async () => {
		vi.stubEnv("FLAME_CODING_AGENT_DIR", testDir);

		mocks.spawn.mockImplementation(() => {
			const mockChild = new EventEmitter() as EventEmitter & {
				pid: number;
				unref: () => void;
			};
			mockChild.pid = 4242;
			mockChild.unref = vi.fn();
			return mockChild;
		});

		const result = await processTool.execute("call-1", {
			command: "npm run build",
		});

		expect(getTextOutput(result)).toContain("Background process started");
		expect(getTextOutput(result)).toContain("notified automatically");
		expect(result.details?.taskId).toMatch(/^proc_/);
		expect(result.details?.pid).toBe(4242);
	});

	it("notifies the agent when a background process exits", async () => {
		vi.stubEnv("FLAME_CODING_AGENT_DIR", testDir);
		const notifications: string[] = [];
		setProcessTaskCompletionHandler((completion) => {
			notifications.push(formatProcessTaskCompletionMessage(completion));
		});

		let exitHandler: ((code: number) => void) | undefined;
		mocks.spawn.mockImplementation(() => {
			const mockChild = new EventEmitter() as EventEmitter & {
				pid: number;
				unref: () => void;
				on: (event: string, handler: (code: number) => void) => EventEmitter;
			};
			mockChild.pid = 7777;
			mockChild.unref = vi.fn();
			const originalOn = mockChild.on.bind(mockChild);
			mockChild.on = ((event: string, handler: (code: number) => void) => {
				if (event === "exit") {
					exitHandler = handler;
				}
				return originalOn(event, handler);
			}) as typeof mockChild.on;
			return mockChild;
		});

		const result = await processTool.execute("call-2", {
			command: "echo done",
		});
		const taskId = result.details?.taskId;
		expect(taskId).toBeDefined();

		exitHandler?.(0);

		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain(`Background process ${taskId} finished with status: success`);
	});

	it("reports status for finished tasks from saved metadata", async () => {
		vi.stubEnv("FLAME_CODING_AGENT_DIR", testDir);
		const processesDir = join(testDir, "processes");
		mkdirSync(processesDir, { recursive: true });
		const taskId = "proc_test_123";
		writeFileSync(
			join(processesDir, `${taskId}.json`),
			JSON.stringify({
				taskId,
				command: "echo hello",
				cwd: testDir,
				status: "running",
				pid: 0,
				exitCode: null,
				signal: null,
				startedAt: Date.now(),
				notify: true,
			}),
		);
		writeFileSync(join(processesDir, `${taskId}.log`), "hello\n");

		const meta = JSON.parse(readFileSync(join(processesDir, `${taskId}.json`), "utf-8"));
		const summary = summarizeProcessTask(meta, processesDir, true);
		expect(summary.status).toBe("failed");

		const result = await processTool.execute("call-3", {
			action: "status",
			taskId,
		});
		expect(getTextOutput(result)).toContain("Process Task Status");
		expect(getTextOutput(result)).toContain("hello");
	});
});
