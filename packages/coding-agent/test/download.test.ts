import { EventEmitter } from "events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	return {
		spawn: vi.fn(),
	};
});

vi.mock("child_process", () => {
	return {
		spawn: mocks.spawn,
	};
});

import { createDownloadTool } from "../src/core/tools/download.ts";

const downloadTool = createDownloadTool(process.cwd());

function getTextOutput(result: any): string {
	return (
		result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n") || ""
	);
}

describe("download tool", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `download-tool-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		mocks.spawn.mockReset();
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("should parse progress correctly and translate options to aria2c arguments", async () => {
		const targetFile = join(testDir, "test.zip");
		mocks.spawn.mockImplementation(() => {
			const mockChild: any = new EventEmitter();
			mockChild.stdout = new EventEmitter();
			mockChild.stderr = new EventEmitter();
			mockChild.killed = false;
			mockChild.kill = vi.fn();

			// Simulate process outputting progress and closing
			setTimeout(() => {
				mockChild.stdout.emit("data", Buffer.from("[#ea39bd 1.2MiB/4.3MiB(27%) CN:16 DL:1.2MiB ETA:2s]\n"));
				setTimeout(() => {
					// Simulate successful completion log
					mockChild.stdout.emit("data", Buffer.from(`Download complete: ${targetFile}\n`));
					// Write the dummy file to simulate download on disk
					writeFileSync(targetFile, "dummy zip content");
					mockChild.emit("close", 0);
				}, 10);
			}, 10);

			return mockChild;
		});

		const updates: any[] = [];
		const result = await downloadTool.execute(
			"test-call-1",
			{
				url: "http://example.com/test.zip",
				dir: testDir,
				filename: "test.zip",
				connections: 8,
				speedLimit: "1M",
				skipTls: true,
			},
			undefined,
			(update) => {
				updates.push(update);
			},
		);

		expect(getTextOutput(result)).toContain("Successfully downloaded file");
		expect(getTextOutput(result)).toContain("Size:");
		expect(getTextOutput(result)).toContain("Speed:");
		expect(getTextOutput(result)).toContain("Time:");
		expect(updates.some((u) => u.content[0]?.text?.includes("27%"))).toBe(true);

		expect(mocks.spawn).toHaveBeenCalled();
		const argsPassed = mocks.spawn.mock.calls[0][1] as string[];
		expect(argsPassed).toContain("-x8");
		expect(argsPassed).toContain("-s8");
		expect(argsPassed).toContain("--max-download-limit=1M");
		expect(argsPassed).toContain("--check-certificate=false");
	});

	it("should validate min and max file sizes", async () => {
		const targetFile = join(testDir, "size-test.zip");
		mocks.spawn.mockImplementation(() => {
			const mockChild: any = new EventEmitter();
			mockChild.stdout = new EventEmitter();
			mockChild.stderr = new EventEmitter();
			mockChild.killed = false;

			setTimeout(() => {
				mockChild.stdout.emit("data", Buffer.from(`Download complete: ${targetFile}\n`));
				// File size is 18 bytes
				writeFileSync(targetFile, "dummy zip content!");
				mockChild.emit("close", 0);
			}, 10);

			return mockChild;
		});

		// minSize is 100 bytes (should throw)
		await expect(
			downloadTool.execute("test-call-2", {
				url: "http://example.com/size-test.zip",
				dir: testDir,
				filename: "size-test.zip",
				minSize: "100",
			}),
		).rejects.toThrow("smaller than the minimum expected size");

		expect(existsSync(targetFile)).toBe(false);
	});

	it("should perform dry-run successfully without downloading", async () => {
		mocks.spawn.mockImplementation(() => {
			const mockChild: any = new EventEmitter();
			mockChild.stdout = new EventEmitter();
			mockChild.stderr = new EventEmitter();
			mockChild.killed = false;

			setTimeout(() => {
				mockChild.emit("close", 0);
			}, 10);

			return mockChild;
		});

		const result = await downloadTool.execute("test-call-dryrun", {
			url: "http://example.com/dryrun.zip",
			dir: testDir,
			filename: "dryrun.zip",
			dryRun: true,
		});

		expect(getTextOutput(result)).toContain("Dry run completed successfully");
		const argsPassed = mocks.spawn.mock.calls[0][1] as string[];
		expect(argsPassed).toContain("--dry-run=true");
	});

	it("should fail download if checksum does not match", async () => {
		const targetFile = join(testDir, "hash-test.txt");
		mocks.spawn.mockImplementation(() => {
			const mockChild: any = new EventEmitter();
			mockChild.stdout = new EventEmitter();
			mockChild.stderr = new EventEmitter();
			mockChild.killed = false;

			setTimeout(() => {
				mockChild.stdout.emit("data", Buffer.from(`Download complete: ${targetFile}\n`));
				writeFileSync(targetFile, "test data");
				mockChild.emit("close", 0);
			}, 10);

			return mockChild;
		});

		// Expected sha256 checksum of "test data" is: 916f0027a575de21f1778120ec26c04f909187313a89047249be524d7768f763
		// We pass a wrong one:
		await expect(
			downloadTool.execute("test-call-checksum-fail", {
				url: "http://example.com/hash-test.txt",
				dir: testDir,
				filename: "hash-test.txt",
				checksum: "sha256=wronghash123",
			}),
		).rejects.toThrow("Checksum verification failed");

		expect(existsSync(targetFile)).toBe(false);
	});

	it("should start download in the background as a task", async () => {
		const oldAgentDir = process.env.FLAME_CODING_AGENT_DIR;
		process.env.FLAME_CODING_AGENT_DIR = testDir;

		mocks.spawn.mockImplementation(() => {
			const mockChild: any = new EventEmitter();
			mockChild.pid = 9999;
			mockChild.unref = vi.fn();
			return mockChild;
		});

		try {
			const result = await downloadTool.execute("test-call-bg", {
				url: "http://example.com/bgfile.zip",
				dir: testDir,
				filename: "bgfile.zip",
				background: true,
			});

			expect(getTextOutput(result)).toContain("Download started in the background");
			expect(result.details?.taskId).toBeDefined();
			expect(result.details?.pid).toBe(9999);
		} finally {
			if (oldAgentDir === undefined) {
				delete process.env.FLAME_CODING_AGENT_DIR;
			} else {
				process.env.FLAME_CODING_AGENT_DIR = oldAgentDir;
			}
		}
	});

	it("should query status of background tasks and abort tasks", async () => {
		const oldAgentDir = process.env.FLAME_CODING_AGENT_DIR;
		process.env.FLAME_CODING_AGENT_DIR = testDir;

		try {
			const downloadsDir = join(testDir, "downloads");
			mkdirSync(downloadsDir, { recursive: true });

			const taskId = "dl_test_123";
			const metaPath = join(downloadsDir, `${taskId}.json`);
			const logPath = join(downloadsDir, `${taskId}.log`);

			const meta = {
				taskId,
				url: "http://example.com/statusfile.zip",
				dir: testDir,
				filename: "statusfile.zip",
				savePath: join(testDir, "statusfile.zip"),
				status: "running",
				percent: 0,
				pid: 0,
			};
			writeFileSync(metaPath, JSON.stringify(meta, null, 2));
			writeFileSync(
				logPath,
				"[#ea39bd 1.2MiB/4.3MiB(27%) CN:16 DL:1.2MiB ETA:2s]\nDownload complete: statusfile.zip\n",
			);

			// Query status
			const statusResult = await downloadTool.execute("test-call-status", {
				action: "status",
				taskId,
			});

			expect(getTextOutput(statusResult)).toContain("Status: success");
			expect(statusResult.details?.percent).toBe(100);

			// Query list
			const listResult = await downloadTool.execute("test-call-list", {
				action: "list",
			});
			expect(getTextOutput(listResult)).toContain("Task ID: dl_test_123");

			// Abort task
			const abortResult = await downloadTool.execute("test-call-abort", {
				action: "abort",
				taskId,
			});
			expect(getTextOutput(abortResult)).toContain("Successfully aborted download task");
		} finally {
			if (oldAgentDir === undefined) {
				delete process.env.FLAME_CODING_AGENT_DIR;
			} else {
				process.env.FLAME_CODING_AGENT_DIR = oldAgentDir;
			}
		}
	});

	it("should download into tempDir and move the file to the target dir", async () => {
		const tempDir = join(testDir, "temp");
		const targetDir = join(testDir, "target");
		mkdirSync(tempDir, { recursive: true });
		mkdirSync(targetDir, { recursive: true });

		mocks.spawn.mockImplementation((_cmd, spawnArgs: string[]) => {
			const mockChild: any = new EventEmitter();
			mockChild.stdout = new EventEmitter();
			mockChild.stderr = new EventEmitter();
			mockChild.killed = false;

			setTimeout(() => {
				const outputName = spawnArgs[spawnArgs.indexOf("-o") + 1] || "moved.zip";
				const tempFile = join(tempDir, outputName);
				writeFileSync(tempFile, "temp download");
				mockChild.stdout.emit("data", Buffer.from(`Download complete: ${tempFile}\n`));
				mockChild.emit("close", 0);
			}, 10);

			return mockChild;
		});

		const result = await downloadTool.execute("test-call-tempdir", {
			url: "http://example.com/moved.zip",
			dir: targetDir,
			filename: "moved.zip",
			tempDir,
		});

		expect(getTextOutput(result)).toContain("Successfully downloaded file");
		expect(existsSync(join(targetDir, "moved.zip"))).toBe(true);
		expect(existsSync(join(tempDir, "moved.zip"))).toBe(false);
		const argsPassed = mocks.spawn.mock.calls[0][1] as string[];
		expect(argsPassed).toContain("-d");
		expect(argsPassed[argsPassed.indexOf("-d") + 1]).toBe(tempDir);
	});
});
