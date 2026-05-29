import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

const BASE_CWD = "/tmp/test";

describe("buildSystemPrompt — default identity path", () => {
	it("uses the hardcoded 'You are Flame' identity when no `identity` option is provided", () => {
		const prompt = buildSystemPrompt({ cwd: BASE_CWD });
		expect(prompt).toMatch(/^You are Flame, an expert coding assistant/);
	});

	it("replaces the default identity paragraph when `identity` is provided", () => {
		const prompt = buildSystemPrompt({
			cwd: BASE_CWD,
			identity: "You are Solaris, a thoughtful coding partner with infinite patience.",
		});
		expect(prompt).toMatch(/^You are Solaris, a thoughtful coding partner/);
		// The rest of the structure (Available tools, Guidelines, Flame docs) stays.
		expect(prompt).toContain("Available tools:");
		expect(prompt).toContain("Guidelines:");
		expect(prompt).toContain("Flame documentation");
	});

	it("ignores empty / whitespace-only identity and falls back to the default", () => {
		const prompt = buildSystemPrompt({ cwd: BASE_CWD, identity: "   \n   " });
		expect(prompt).toMatch(/^You are Flame, an expert coding assistant/);
	});
});

describe("buildSystemPrompt — volatileBlocks injection", () => {
	it("appends volatile blocks after skills and before date/cwd", () => {
		const memoryBlock =
			"══════════════════════════════════════════════\n" +
			"MEMORY (your personal notes) [10% — 220/2,200 chars]\n" +
			"══════════════════════════════════════════════\n" +
			"User prefers terse responses";
		const prompt = buildSystemPrompt({
			cwd: BASE_CWD,
			volatileBlocks: [memoryBlock],
		});
		const dateIdx = prompt.indexOf("Current date:");
		const cwdIdx = prompt.indexOf("Current working directory:");
		const blockIdx = prompt.indexOf(memoryBlock);
		expect(blockIdx).toBeGreaterThan(0);
		expect(dateIdx).toBeGreaterThan(blockIdx);
		expect(cwdIdx).toBeGreaterThan(blockIdx);
	});

	it("filters out empty / whitespace blocks", () => {
		const prompt = buildSystemPrompt({
			cwd: BASE_CWD,
			volatileBlocks: ["", "   ", "real block content"],
		});
		expect(prompt).toContain("real block content");
		// No double-blank doubled separators introduced by empty entries
		expect(prompt).not.toMatch(/\n\n\n\n/);
	});

	it("renders nothing extra when volatileBlocks is empty", () => {
		const promptWith = buildSystemPrompt({
			cwd: BASE_CWD,
			volatileBlocks: [],
		});
		const promptWithout = buildSystemPrompt({ cwd: BASE_CWD });
		expect(promptWith).toBe(promptWithout);
	});
});

describe("buildSystemPrompt — customPrompt path also respects volatileBlocks", () => {
	it("injects volatile blocks into custom prompts before date/cwd", () => {
		const prompt = buildSystemPrompt({
			cwd: BASE_CWD,
			customPrompt: "Custom system instructions here.",
			volatileBlocks: ["MEMORY: user prefers concise"],
		});
		expect(prompt).toMatch(/^Custom system instructions here\./);
		const memoryIdx = prompt.indexOf("MEMORY: user prefers concise");
		const dateIdx = prompt.indexOf("Current date:");
		expect(memoryIdx).toBeGreaterThan(0);
		expect(dateIdx).toBeGreaterThan(memoryIdx);
	});

	it("respects customPrompt over identity (customPrompt wins, identity ignored)", () => {
		const prompt = buildSystemPrompt({
			cwd: BASE_CWD,
			customPrompt: "Custom system instructions here.",
			identity: "This identity should NOT appear because customPrompt takes precedence.",
		});
		expect(prompt).toMatch(/^Custom system instructions here\./);
		expect(prompt).not.toContain("This identity should NOT appear");
	});
});

describe("buildSystemPrompt — date stability across re-renders", () => {
	it("produces the same date string for two builds in the same day (date-only, not minute-precision)", () => {
		const a = buildSystemPrompt({ cwd: BASE_CWD });
		const b = buildSystemPrompt({ cwd: BASE_CWD });
		const dateA = a.match(/Current date: (\d{4}-\d{2}-\d{2})/)?.[1];
		const dateB = b.match(/Current date: (\d{4}-\d{2}-\d{2})/)?.[1];
		expect(dateA).toBeDefined();
		expect(dateA).toBe(dateB);
		// Confirm minute precision is NOT in the date line (would break prefix cache).
		expect(a).not.toMatch(/Current date: \d{4}-\d{2}-\d{2}T/);
	});
});
