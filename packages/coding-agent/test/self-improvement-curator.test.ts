import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAutomaticTransitions, type CuratorSettings } from "../src/core/self-improvement/curator.ts";
import { defaultCuratorState } from "../src/core/self-improvement/curator-state.ts";
import { getSkillsDir } from "../src/core/skills/paths.ts";
import { resetSkillsPromptCacheForTests } from "../src/core/skills/prompt-index.ts";

const SETTINGS: CuratorSettings = {
	enabled: true,
	intervalHours: 168,
	staleAfterDays: 30,
	archiveAfterDays: 90,
	maxBackups: 5,
	llmConsolidation: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

let tempHome: string;
let originalFlameHome: string | undefined;

function createSkill(name: string, ageDays: number): void {
	const dir = join(getSkillsDir(), name);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	writeFileSync(file, `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`, "utf-8");
	const when = new Date(Date.now() - ageDays * DAY_MS);
	utimesSync(file, when, when);
}

beforeEach(() => {
	tempHome = mkdtempSync(join(tmpdir(), "flame-curator-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = tempHome;
	mkdirSync(getSkillsDir(), { recursive: true });
	resetSkillsPromptCacheForTests();
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	rmSync(tempHome, { recursive: true, force: true });
});

describe("curator applyAutomaticTransitions", () => {
	it("marks inactive skills stale and very old ones archived; leaves fresh ones alone", () => {
		createSkill("fresh", 1);
		createSkill("stale-one", 45);
		createSkill("ancient", 120);
		const state = defaultCuratorState();

		const counts = applyAutomaticTransitions(state, SETTINGS);

		expect(counts.checked).toBe(3);
		expect(state.states.fresh).toBeUndefined(); // still active, untouched
		expect(state.states["stale-one"]).toBe("stale");
		expect(state.states.ancient).toBe("archived");

		// Archived skill directory was moved into .archive/, never deleted.
		expect(existsSync(join(getSkillsDir(), "ancient"))).toBe(false);
		expect(existsSync(join(getSkillsDir(), ".archive", "ancient", "SKILL.md"))).toBe(true);
	});

	it("never touches pinned skills", () => {
		createSkill("pinned-old", 200);
		const state = defaultCuratorState();
		state.pinned = ["pinned-old"];

		const counts = applyAutomaticTransitions(state, SETTINGS);

		expect(counts.archived).toBe(0);
		expect(state.states["pinned-old"]).toBeUndefined();
		expect(existsSync(join(getSkillsDir(), "pinned-old", "SKILL.md"))).toBe(true);
	});

	it("reactivates a stale skill that became active again", () => {
		createSkill("revived", 1); // fresh on disk
		const state = defaultCuratorState();
		state.states.revived = "stale"; // but previously marked stale

		const counts = applyAutomaticTransitions(state, SETTINGS);

		expect(counts.reactivated).toBe(1);
		expect(state.states.revived).toBe("active");
	});
});
