/**
 * The antigravity tool launches the real `agy` binary off PATH. To exercise it
 * without making real Antigravity calls, these tests prepend a temp directory
 * holding a fake `agy` shell script to PATH and assert on how the tool spawns it
 * and handles its plain-text output.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AntigravityToolDetails,
	type AntigravityToolInput,
	createAntigravityToolDefinition,
} from "../src/core/tools/antigravity.ts";

let binDir: string;
let workDir: string;
let originalPath: string | undefined;

beforeEach(() => {
	binDir = mkdtempSync(join(tmpdir(), "flame-agy-bin-"));
	workDir = mkdtempSync(join(tmpdir(), "flame-agy-cwd-"));
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	rmSync(binDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
});

function writeFakeAgy(body: string): void {
	const file = join(binDir, "agy");
	writeFileSync(file, body, { mode: 0o755 });
	chmodSync(file, 0o755);
}

/** Make the working dir look like a git repo so the tool doesn't warn. */
function makeGitRepo(): void {
	mkdirSync(join(workDir, ".git"), { recursive: true });
}

function run(
	def: ReturnType<typeof createAntigravityToolDefinition>,
	params: AntigravityToolInput,
	signal?: AbortSignal,
) {
	return def.execute("call", params, signal, undefined, undefined as never);
}

function getText(result: { content: { type: string }[] }): string {
	const part = result.content.find((c): c is { type: "text"; text: string } => c.type === "text");
	return part?.text ?? "";
}

describe("antigravity tool", () => {
	it("returns the agy response text on success", async () => {
		makeGitRepo();
		writeFakeAgy(`#!/bin/sh\necho "Created the file as requested."\n`);
		const def = createAntigravityToolDefinition(workDir);
		const result = await run(def, { prompt: "make a file" });
		const details = result.details as AntigravityToolDetails;

		expect(details.status).toBe("ok");
		expect(details.exitCode).toBe(0);
		expect(details.notGitRepo).toBe(false);
		expect(getText(result)).toContain("Created the file as requested.");
	});

	it("launches headless with bypassed permissions and the workspace dir", async () => {
		makeGitRepo();
		const argsFile = join(workDir, "args.txt");
		writeFakeAgy(`#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\necho done\n`);
		const def = createAntigravityToolDefinition(workDir);
		await run(def, { prompt: "refactor the parser", timeout_seconds: 600 });

		const passedArgs = readFileSync(argsFile, "utf-8");
		expect(passedArgs).toContain("-p");
		expect(passedArgs).toContain("refactor the parser");
		expect(passedArgs).toContain("--dangerously-skip-permissions");
		expect(passedArgs).toContain("--add-dir");
		expect(passedArgs).toContain(workDir);
		expect(passedArgs).toContain("--print-timeout");
		expect(passedArgs).toContain("600s");
	});

	it("warns when the working directory is not a git repo", async () => {
		// No .git in workDir -> agy would use its scratch workspace.
		writeFakeAgy(`#!/bin/sh\necho "did something in scratch"\n`);
		const def = createAntigravityToolDefinition(workDir);
		const result = await run(def, { prompt: "do it" });
		const details = result.details as AntigravityToolDetails;

		expect(details.status).toBe("ok");
		expect(details.notGitRepo).toBe(true);
		expect(getText(result)).toContain("not a git repo");
	});

	it("reports an error when agy exits non-zero", async () => {
		makeGitRepo();
		writeFakeAgy(`#!/bin/sh\necho "boom" >&2\nexit 2\n`);
		const def = createAntigravityToolDefinition(workDir);
		const result = await run(def, { prompt: "explode" });
		const details = result.details as AntigravityToolDetails;

		expect(details.status).toBe("error");
		expect(details.exitCode).toBe(2);
		expect(getText(result)).toContain("failed");
	});

	it("reports a clear error when the agy binary is missing", async () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "flame-agy-empty-"));
		process.env.PATH = emptyDir;
		try {
			const def = createAntigravityToolDefinition(workDir);
			const result = await run(def, { prompt: "anything" });
			const details = result.details as AntigravityToolDetails;

			expect(details.status).toBe("error");
			expect(getText(result)).toContain("not found on PATH");
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("rejects an empty prompt without spawning", async () => {
		const def = createAntigravityToolDefinition(workDir);
		const result = await run(def, { prompt: "   " });
		expect((result.details as AntigravityToolDetails).status).toBe("error");
		expect(getText(result)).toContain("non-empty prompt");
	});

	it("kills the run and reports aborted when the signal fires", async () => {
		makeGitRepo();
		writeFakeAgy(`#!/bin/sh\nexec sleep 30\n`);
		const def = createAntigravityToolDefinition(workDir);
		const controller = new AbortController();
		const pending = run(def, { prompt: "long task" }, controller.signal);
		setTimeout(() => controller.abort(), 100);
		const result = await pending;

		expect((result.details as AntigravityToolDetails).status).toBe("aborted");
	});
});
