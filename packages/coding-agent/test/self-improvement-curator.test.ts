import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAutomaticTransitions, type CuratorSettings } from "../src/core/self-improvement/curator.ts";
import { getSkillsDir } from "../src/core/skills/paths.ts";
import { resetSkillsPromptCacheForTests } from "../src/core/skills/prompt-index.ts";
import { getRecord, loadUsage, saveUsage, type UsageRecord } from "../src/core/skills/skill-usage.ts";

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

/** Create a plain skill on disk (no usage record — not curator-managed). */
function createSkill(name: string): void {
	const dir = join(getSkillsDir(), name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`, "utf-8");
}

/**
 * Create an agent-created (curator-managed) skill with a usage record whose
 * activity is `activityAgeDays` old. Mirrors how the background review fork
 * would have created and used it.
 */
async function createManagedSkill(
	name: string,
	activityAgeDays: number,
	opts: { state?: UsageRecord["state"]; pinned?: boolean } = {},
): Promise<void> {
	createSkill(name);
	const activityIso = new Date(Date.now() - activityAgeDays * DAY_MS).toISOString();
	const map = loadUsage();
	map[name] = {
		created_by: "agent",
		use_count: 1,
		view_count: 0,
		last_used_at: activityIso,
		last_viewed_at: null,
		patch_count: 0,
		last_patched_at: null,
		created_at: activityIso,
		state: opts.state ?? "active",
		pinned: opts.pinned ?? false,
		archived_at: null,
	};
	await saveUsage(map);
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
	it("marks inactive skills stale and very old ones archived; leaves fresh ones alone", async () => {
		await createManagedSkill("fresh", 1);
		await createManagedSkill("stale-one", 45);
		await createManagedSkill("ancient", 120);

		const counts = await applyAutomaticTransitions(SETTINGS);

		expect(counts.checked).toBe(3);
		expect(getRecord("fresh").state).toBe("active"); // still active, untouched
		expect(getRecord("stale-one").state).toBe("stale");
		expect(getRecord("ancient").state).toBe("archived");

		// Archived skill directory was moved into .archive/, never deleted.
		expect(existsSync(join(getSkillsDir(), "ancient"))).toBe(false);
		expect(existsSync(join(getSkillsDir(), ".archive", "ancient", "SKILL.md"))).toBe(true);
	});

	it("never touches pinned skills", async () => {
		await createManagedSkill("pinned-old", 200, { pinned: true });

		const counts = await applyAutomaticTransitions(SETTINGS);

		expect(counts.archived).toBe(0);
		expect(getRecord("pinned-old").state).toBe("active");
		expect(existsSync(join(getSkillsDir(), "pinned-old", "SKILL.md"))).toBe(true);
	});

	it("reactivates a stale skill that became active again", async () => {
		await createManagedSkill("revived", 1, { state: "stale" }); // fresh activity, was stale

		const counts = await applyAutomaticTransitions(SETTINGS);

		expect(counts.reactivated).toBe(1);
		expect(getRecord("revived").state).toBe("active");
	});

	it("ignores skills that are not agent-created (user-authored)", async () => {
		createSkill("user-skill"); // no usage record → not curator-managed

		const counts = await applyAutomaticTransitions(SETTINGS);

		expect(counts.checked).toBe(0);
		expect(existsSync(join(getSkillsDir(), "user-skill", "SKILL.md"))).toBe(true);
	});
});

describe("curator snapshot and restore", () => {
	it("can snapshot the skills tree and successfully restore it", () => {
		const { listSnapshots, restoreSkillsSnapshot, snapshotSkills } = require("../src/core/self-improvement/index.ts");
		createSkill("skill-a");
		createSkill("skill-b");

		// Take snapshot
		const snapPath = snapshotSkills("test-snapshot", 5);
		expect(snapPath).toBeDefined();

		const snapshots = listSnapshots();
		expect(snapshots.length).toBe(1);

		// Mutate skill files (e.g. write a new skill, delete skill-a)
		createSkill("skill-c");
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
		await createManagedSkill("ancient-skill", 120);

		const result = await maybeRunCurator({
			settings: SETTINGS,
			force: true,
			dryRun: true,
		});

		expect(result.ran).toBe(true);
		expect(result.summary).toContain("dry-run");
		expect(result.counts.archived).toBe(1);

		// Directory must NOT have been moved since it's a dry-run
		expect(existsSync(join(getSkillsDir(), "ancient-skill", "SKILL.md"))).toBe(true);
		expect(getRecord("ancient-skill").state).toBe("active"); // unchanged on disk

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
