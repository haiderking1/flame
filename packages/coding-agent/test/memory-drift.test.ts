import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectExternalDrift, ENTRY_DELIMITER, parseEntries, serializeEntries } from "../src/core/memory/drift.ts";

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "flame-mem-drift-"));
});
afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

describe("parseEntries / serializeEntries", () => {
	it("round-trips a §-delimited list", () => {
		const raw = `entry one${ENTRY_DELIMITER}entry two${ENTRY_DELIMITER}entry three`;
		const parsed = parseEntries(raw);
		expect(parsed).toEqual(["entry one", "entry two", "entry three"]);
		expect(serializeEntries(parsed)).toBe(raw);
	});

	it("treats whitespace-only input as empty", () => {
		expect(parseEntries("   \n  ")).toEqual([]);
		expect(serializeEntries([])).toBe("");
	});

	it("strips empty entries between delimiters", () => {
		const raw = `a${ENTRY_DELIMITER}${ENTRY_DELIMITER}b`;
		expect(parseEntries(raw)).toEqual(["a", "b"]);
	});
});

describe("detectExternalDrift", () => {
	it("returns no drift for a missing file", async () => {
		const result = await detectExternalDrift(join(tempDir, "MEMORY.md"), 2200);
		expect(result.driftDetected).toBe(false);
		expect(result.backupPath).toBeUndefined();
	});

	it("returns no drift for an empty file", async () => {
		const path = join(tempDir, "MEMORY.md");
		writeFileSync(path, "", "utf-8");
		const result = await detectExternalDrift(path, 2200);
		expect(result.driftDetected).toBe(false);
	});

	it("returns no drift for a tool-shaped file", async () => {
		const path = join(tempDir, "MEMORY.md");
		writeFileSync(path, `entry alpha${ENTRY_DELIMITER}entry beta`, "utf-8");
		const result = await detectExternalDrift(path, 2200);
		expect(result.driftDetected).toBe(false);
	});

	it("detects round-trip mismatch and backs the file up", async () => {
		const path = join(tempDir, "MEMORY.md");
		// Empty entry between two delimiters — gets stripped on parse so the
		// re-serialized form doesn't equal the original raw bytes.
		writeFileSync(path, `entry alpha${ENTRY_DELIMITER}${ENTRY_DELIMITER}entry beta`, "utf-8");
		const result = await detectExternalDrift(path, 2200);
		expect(result.driftDetected).toBe(true);
		expect(result.backupPath).toBeDefined();
		const backup = readFileSync(result.backupPath as string, "utf-8");
		expect(backup).toContain("entry alpha");
		expect(backup).toContain("entry beta");
	});

	it("detects entry-size overflow even when round-trip would pass", async () => {
		const path = join(tempDir, "MEMORY.md");
		const huge = "x".repeat(500);
		writeFileSync(path, huge, "utf-8"); // single entry, no delimiter
		const result = await detectExternalDrift(path, 100); // tiny limit
		expect(result.driftDetected).toBe(true);
		expect(result.backupPath).toBeDefined();
	});
});
