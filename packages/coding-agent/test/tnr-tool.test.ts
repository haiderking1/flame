/**
 * The tnr tool launches the real `tnr` and `ssh` binaries off PATH. To exercise
 * it without touching Thunder Compute, these tests prepend a temp dir holding
 * fake `tnr`/`ssh` shell scripts to PATH and assert on how the tool spawns them
 * and how it surfaces stdout/stderr/exit code.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTnrToolDefinition, type TnrToolDetails, type TnrToolInput } from "../src/core/tools/tnr.ts";

let binDir: string;
let workDir: string;
let originalPath: string | undefined;

beforeEach(() => {
	binDir = mkdtempSync(join(tmpdir(), "flame-tnr-bin-"));
	workDir = mkdtempSync(join(tmpdir(), "flame-tnr-cwd-"));
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterEach(() => {
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	rmSync(binDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
});

/** Write a fake binary that records its argv to <name>.args and runs `body`. */
function writeFakeBin(name: string, body = "echo ok"): string {
	const argsFile = join(workDir, `${name}.args`);
	const file = join(binDir, name);
	writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n${body}\n`, { mode: 0o755 });
	chmodSync(file, 0o755);
	return argsFile;
}

function run(def: ReturnType<typeof createTnrToolDefinition>, params: TnrToolInput, signal?: AbortSignal) {
	return def.execute("call", params, signal, undefined, undefined as never);
}

function getText(result: { content: { type: string }[] }): string {
	const part = result.content.find((c): c is { type: "text"; text: string } => c.type === "text");
	return part?.text ?? "";
}

describe("tnr tool", () => {
	it("status runs `tnr status --no-wait` and reports output + exit code", async () => {
		const argsFile = writeFakeBin("tnr", `echo "No instances found."`);
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "status" });
		const details = result.details as TnrToolDetails;

		expect(readFileSync(argsFile, "utf-8").trim().split("\n")).toEqual(["status", "--no-wait"]);
		expect(details.status).toBe("ok");
		expect(details.exitCode).toBe(0);
		expect(getText(result)).toContain("exit code: 0");
		expect(getText(result)).toContain("No instances found.");
	});

	it("run execs the command on the instance over ssh with the tnr-<id> alias", async () => {
		const argsFile = writeFakeBin("ssh", `echo "GPU: A100"`);
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "run", instance: "0", command: "nvidia-smi" });

		const argv = readFileSync(argsFile, "utf-8").trim().split("\n");
		expect(argv).toContain("tnr-0");
		expect(argv).toContain("nvidia-smi");
		expect(argv).toContain("BatchMode=yes");
		expect((result.details as TnrToolDetails).status).toBe("ok");
		expect(getText(result)).toContain("GPU: A100");
	});

	it("run prefixes a remote cd when cwd is given", async () => {
		const argsFile = writeFakeBin("ssh", "echo done");
		const def = createTnrToolDefinition(workDir);
		await run(def, { action: "run", instance: "0", command: "python train.py", cwd: "/root/job" });

		const remoteCmd = readFileSync(argsFile, "utf-8");
		expect(remoteCmd).toContain("cd '/root/job' && python train.py");
	});

	it("run explains how to fix a missing SSH alias", async () => {
		writeFakeBin("ssh", `echo "ssh: Could not resolve hostname tnr-7: Name or service not known" >&2\nexit 255`);
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "run", instance: "7", command: "ls" });

		expect((result.details as TnrToolDetails).status).toBe("error");
		expect(getText(result)).toContain("tnr connect 7");
	});

	it("upload maps to `tnr scp <local> <id>:<remote>`", async () => {
		const argsFile = writeFakeBin("tnr");
		const def = createTnrToolDefinition(workDir);
		await run(def, { action: "upload", instance: "0", local: "train.jsonl", remote: "/root/train.jsonl" });

		expect(readFileSync(argsFile, "utf-8").trim().split("\n")).toEqual(["scp", "train.jsonl", "0:/root/train.jsonl"]);
	});

	it("download maps to `tnr scp <id>:<remote> <local>`", async () => {
		const argsFile = writeFakeBin("tnr");
		const def = createTnrToolDefinition(workDir);
		await run(def, { action: "download", instance: "0", remote: "/root/adapter/", local: "./adapter" });

		expect(readFileSync(argsFile, "utf-8").trim().split("\n")).toEqual(["scp", "0:/root/adapter/", "./adapter"]);
	});

	it("create passes extra args through to `tnr create`", async () => {
		const argsFile = writeFakeBin("tnr");
		const def = createTnrToolDefinition(workDir);
		await run(def, { action: "create", args: ["--gpu", "a100", "--vcpus", "8"] });

		expect(readFileSync(argsFile, "utf-8").trim().split("\n")).toEqual(["create", "--gpu", "a100", "--vcpus", "8"]);
	});

	it("cli is a raw `tnr` passthrough", async () => {
		const argsFile = writeFakeBin("tnr");
		const def = createTnrToolDefinition(workDir);
		await run(def, { action: "cli", args: ["snapshot", "create", "--instance-id", "0"] });

		expect(readFileSync(argsFile, "utf-8").trim().split("\n")).toEqual(["snapshot", "create", "--instance-id", "0"]);
	});

	it("validates required params per action without spawning", async () => {
		writeFakeBin("ssh", `echo "should not run" > "${join(workDir, "ssh-ran.txt")}"`);
		const def = createTnrToolDefinition(workDir);

		// All have their instance present, so the failure is a missing sibling field (no resolution).
		for (const params of [
			{ action: "run", instance: "0" }, // missing command
			{ action: "upload", instance: "0", local: "f" }, // missing remote
			{ action: "download", instance: "0", remote: "/r" }, // missing local
			{ action: "cli", args: [] }, // empty args
		] as TnrToolInput[]) {
			const result = await run(def, params);
			expect((result.details as TnrToolDetails).status).toBe("error");
			expect(getText(result)).toMatch(/requires/);
		}
	});

	// A fake tnr whose `status --json` returns `json`, and which records argv of any other call.
	function writeBranchingTnr(statusJson: string): string {
		const argsFile = join(workDir, "tnr.args");
		const file = join(binDir, "tnr");
		writeFileSync(
			file,
			`#!/bin/sh\nif [ "$1" = "status" ]; then echo '${statusJson}'; else printf '%s\\n' "$@" > "${argsFile}"; fi\n`,
			{ mode: 0o755 },
		);
		chmodSync(file, 0o755);
		return argsFile;
	}

	it("auto-detects the sole instance when instance is omitted", async () => {
		const argsFile = writeBranchingTnr('[{"id":0,"status":"RUNNING"}]');
		const def = createTnrToolDefinition(workDir);
		await run(def, { action: "delete" }); // no instance → should resolve to 0

		expect(readFileSync(argsFile, "utf-8").trim().split("\n")).toEqual(["delete", "0"]);
	});

	it("auto-detected instance flows into a remote run over ssh", async () => {
		writeBranchingTnr('[{"id":3,"status":"RUNNING"}]');
		const sshArgs = writeFakeBin("ssh", "echo hi");
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "run", command: "hostname" });

		expect(readFileSync(sshArgs, "utf-8")).toContain("tnr-3");
		expect((result.details as TnrToolDetails).status).toBe("ok");
	});

	it("errors clearly when instance omitted and multiple exist", async () => {
		writeBranchingTnr('[{"id":0},{"id":1}]');
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "run", command: "ls" });

		expect((result.details as TnrToolDetails).status).toBe("error");
		expect(getText(result)).toMatch(/pass "instance"/);
	});

	it("errors clearly when instance omitted and none exist", async () => {
		writeBranchingTnr("[]");
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "upload", local: "f", remote: "/r" });

		expect((result.details as TnrToolDetails).status).toBe("error");
		expect(getText(result)).toMatch(/create/);
	});

	it("reports a non-zero exit code from the remote command", async () => {
		writeFakeBin("ssh", `echo "boom" >&2\nexit 2`);
		const def = createTnrToolDefinition(workDir);
		const result = await run(def, { action: "run", instance: "0", command: "false" });
		const details = result.details as TnrToolDetails;

		expect(details.status).toBe("error");
		expect(details.exitCode).toBe(2);
		expect(getText(result)).toContain("stderr:");
		expect(getText(result)).toContain("boom");
	});

	it("reports a clear error when the tnr binary is missing", async () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "flame-tnr-empty-"));
		process.env.PATH = emptyDir;
		try {
			const def = createTnrToolDefinition(workDir);
			const result = await run(def, { action: "status" });
			expect((result.details as TnrToolDetails).status).toBe("error");
			expect(getText(result)).toContain("not found on PATH");
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("kills the run and reports aborted when the signal fires", async () => {
		writeFakeBin("ssh", "exec sleep 30");
		const def = createTnrToolDefinition(workDir);
		const controller = new AbortController();
		const pending = run(def, { action: "run", instance: "0", command: "sleep 30" }, controller.signal);
		setTimeout(() => controller.abort(), 100);
		const result = await pending;

		expect((result.details as TnrToolDetails).status).toBe("aborted");
	});
});
