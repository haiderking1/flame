/**
 * The claude_code tool launches the real `claude` binary off PATH. To exercise
 * it without making real (paid) Claude Code calls, these tests prepend a temp
 * directory holding a fake `claude` shell script to PATH and assert on how the
 * tool spawns it and parses its JSON output.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type ClaudeCodeToolDetails,
	type ClaudeCodeToolInput,
	createClaudeCodeToolDefinition,
} from "../src/core/tools/claude-code.ts";

let binDir: string;
let workDir: string;
let originalPath: string | undefined;

beforeEach(() => {
	binDir = mkdtempSync(join(tmpdir(), "flame-cc-bin-"));
	workDir = mkdtempSync(join(tmpdir(), "flame-cc-cwd-"));
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	rmSync(binDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
});

/** Drop an executable fake `claude` onto the temp PATH dir. */
function writeFakeClaude(body: string): void {
	const file = join(binDir, "claude");
	writeFileSync(file, body, { mode: 0o755 });
	chmodSync(file, 0o755);
}

function run(
	def: ReturnType<typeof createClaudeCodeToolDefinition>,
	params: ClaudeCodeToolInput,
	signal?: AbortSignal,
) {
	return def.execute("call", params, signal, undefined, undefined as never);
}

function getText(result: { content: { type: string }[] }): string {
	const part = result.content.find((c): c is { type: "text"; text: string } => c.type === "text");
	return part?.text ?? "";
}

describe("claude_code tool", () => {
	it("returns the parsed result and surfaces turns/cost/session on success", async () => {
		writeFakeClaude(
			`#!/bin/sh\ncat <<'EOF'\n{"type":"result","subtype":"success","is_error":false,"result":"did the thing","num_turns":3,"total_cost_usd":0.0123,"session_id":"sess-1","duration_ms":4200}\nEOF\n`,
		);
		const def = createClaudeCodeToolDefinition(workDir);
		const result = await run(def, { prompt: "do the thing" });
		const details = result.details as ClaudeCodeToolDetails;

		expect(details.status).toBe("ok");
		expect(getText(result)).toBe("did the thing");
		expect(details.numTurns).toBe(3);
		expect(details.costUsd).toBeCloseTo(0.0123);
		expect(details.sessionId).toBe("sess-1");
		expect(details.exitCode).toBe(0);
	});

	it("launches headless with bypassed permissions and the prompt", async () => {
		const argsFile = join(workDir, "args.txt");
		writeFakeClaude(
			`#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\necho '{"type":"result","subtype":"success","result":"ok"}'\n`,
		);
		const def = createClaudeCodeToolDefinition(workDir);
		const result = await run(def, { prompt: "refactor the parser", model: "some-model", max_turns: 5 });

		expect((result.details as ClaudeCodeToolDetails).status).toBe("ok");
		const passedArgs = readFileSync(argsFile, "utf-8");
		expect(passedArgs).toContain("-p");
		expect(passedArgs).toContain("refactor the parser");
		expect(passedArgs).toContain("--output-format");
		expect(passedArgs).toContain("--permission-mode");
		expect(passedArgs).toContain("bypassPermissions");
		expect(passedArgs).toContain("--model");
		expect(passedArgs).toContain("some-model");
		expect(passedArgs).toContain("--max-turns");
		expect(passedArgs).toContain("5");
	});

	it("defaults to Opus 4.8 at high thinking when model/effort are omitted", async () => {
		const argsFile = join(workDir, "args.txt");
		writeFakeClaude(
			`#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\necho '{"type":"result","subtype":"success","result":"ok"}'\n`,
		);
		const def = createClaudeCodeToolDefinition(workDir);
		await run(def, { prompt: "just do it" });

		const passedArgs = readFileSync(argsFile, "utf-8");
		expect(passedArgs).toContain("--model");
		expect(passedArgs).toContain("claude-opus-4-8");
		expect(passedArgs).toContain("--effort");
		expect(passedArgs).toContain("high");
	});

	it("reports an error when Claude Code exits non-zero", async () => {
		writeFakeClaude(
			`#!/bin/sh\necho '{"type":"result","subtype":"error_during_execution","is_error":true,"result":""}'\nexit 1\n`,
		);
		const def = createClaudeCodeToolDefinition(workDir);
		const result = await run(def, { prompt: "explode" });
		const details = result.details as ClaudeCodeToolDetails;

		expect(details.status).toBe("error");
		expect(getText(result)).toContain("failed");
	});

	it("reports a clear error when the claude binary is missing", async () => {
		// PATH with only an empty dir -> the spawn fails with ENOENT.
		const emptyDir = mkdtempSync(join(tmpdir(), "flame-cc-empty-"));
		process.env.PATH = emptyDir;
		try {
			const def = createClaudeCodeToolDefinition(workDir);
			const result = await run(def, { prompt: "anything" });
			const details = result.details as ClaudeCodeToolDetails;

			expect(details.status).toBe("error");
			expect(getText(result)).toContain("not found on PATH");
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("rejects an empty prompt without spawning", async () => {
		// No fake claude written; an empty prompt must short-circuit before any spawn.
		const def = createClaudeCodeToolDefinition(workDir);
		const result = await run(def, { prompt: "   " });
		expect((result.details as ClaudeCodeToolDetails).status).toBe("error");
		expect(getText(result)).toContain("non-empty prompt");
	});

	it("kills the run and reports aborted when the signal fires", async () => {
		// `exec` so the long-running process IS the direct child (like real claude),
		// making killProcessTree terminate it immediately rather than orphaning it.
		writeFakeClaude(`#!/bin/sh\nexec sleep 30\n`);
		const def = createClaudeCodeToolDefinition(workDir);
		const controller = new AbortController();
		const pending = run(def, { prompt: "long task" }, controller.signal);
		setTimeout(() => controller.abort(), 100);
		const result = await pending;

		expect((result.details as ClaudeCodeToolDetails).status).toBe("aborted");
	});
});
