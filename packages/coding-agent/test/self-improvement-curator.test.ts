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

describe("curator snapshot and restore", () => {
	it("can snapshot the skills tree and successfully restore it", () => {
		const { listSnapshots, restoreSkillsSnapshot, snapshotSkills } = require("../src/core/self-improvement/index.ts");
		createSkill("skill-a", 1);
		createSkill("skill-b", 5);

		// Take snapshot
		const snapPath = snapshotSkills("test-snapshot", 5);
		expect(snapPath).toBeDefined();

		const snapshots = listSnapshots();
		expect(snapshots.length).toBe(1);

		// Mutate skill files (e.g. write a new skill, delete skill-a)
		createSkill("skill-c", 1);
		rmSync(join(getSkillsDir(), "skill-a"), { recursive: true, force: true });

		expect(existsSync(join(getSkillsDir(), "skill-a"))).toBe(false);
		expect(existsSync(join(getSkillsDir(), "skill-c"))).toBe(true);

		// Restore snapshot
		const ok = restoreSkillsSnapshot(snapshots[0], 5);
		expect(ok).toBe(true);

		// skill-a should be back, skill-c should be gone
		expect(existsSync(join(getSkillsDir(), "skill-a", "SKILL.md"))).toBe(true);
		expect(existsSync(join(getSkillsDir(), "skill-c"))).toBe(false);
		expect(existsSync(join(getSkillsDir(), "skill-b", "SKILL.md"))).toBe(true);
	});
});

describe("curator dry-run and per-run reporting", () => {
	it("does not mutate files during dry-run but successfully writes reports", async () => {
		const { maybeRunCurator } = require("../src/core/self-improvement/index.ts");
		createSkill("ancient-skill", 120);

		const settings = {
			enabled: true,
			intervalHours: 168,
			staleAfterDays: 30,
			archiveAfterDays: 90,
			maxBackups: 5,
			llmConsolidation: false,
		};

		const result = await maybeRunCurator({
			settings,
			force: true,
			dryRun: true,
		});

		expect(result.ran).toBe(true);
		expect(result.summary).toContain("dry-run");
		expect(result.counts.archived).toBe(1);

		// Directory must NOT have been moved since it's a dry-run
		expect(existsSync(join(getSkillsDir(), "ancient-skill", "SKILL.md"))).toBe(true);

		// Assert reports were written under .curator_runs/
		const runsDir = join(getSkillsDir(), ".curator_runs");
		expect(existsSync(runsDir)).toBe(true);

		const { readdirSync, readFileSync } = require("node:fs");
		const dirs = readdirSync(runsDir);
		expect(dirs.length).toBeGreaterThan(0);

		const reportPath = join(runsDir, dirs[0], "REPORT.md");
		expect(existsSync(reportPath)).toBe(true);
		const reportContent = readFileSync(reportPath, "utf-8");
		expect(reportContent).toContain("DRY RUN PASS ONLY");
		expect(reportContent).toContain("ancient-skill");
	});
});
