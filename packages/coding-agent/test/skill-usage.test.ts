import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSkillsDir } from "../src/core/skills/paths.ts";
import { resetSkillsPromptCacheForTests } from "../src/core/skills/prompt-index.ts";
import {
	activityCount,
	agentCreatedReport,
	archiveSkill,
	bumpPatch,
	bumpUse,
	bumpView,
	forget,
	getRecord,
	latestActivityAt,
	listAgentCreatedSkillNames,
	markAgentCreated,
	pinSkill,
	restoreSkill,
} from "../src/core/skills/skill-usage.ts";

let tempHome: string;
let originalFlameHome: string | undefined;

function createSkillFile(name: string): void {
	const dir = join(getSkillsDir(), name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`, "utf-8");
}

beforeEach(() => {
	tempHome = mkdtempSync(join(tmpdir(), "flame-usage-"));
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

describe("skill-usage counters", () => {
	it("bumps view, use, and patch counters with timestamps", async () => {
		await bumpView("alpha");
		await bumpUse("alpha");
		await bumpUse("alpha");
		await bumpPatch("alpha");

		const rec = getRecord("alpha");
		expect(rec.view_count).toBe(1);
		expect(rec.use_count).toBe(2);
		expect(rec.patch_count).toBe(1);
		expect(rec.last_used_at).toBeTruthy();
		expect(rec.last_viewed_at).toBeTruthy();
		expect(rec.last_patched_at).toBeTruthy();
		expect(activityCount(rec)).toBe(4);
	});

	it("latestActivityAt picks the newest of used/viewed/patched, ignoring created_at", () => {
		const rec = {
			created_at: "2030-01-01T00:00:00.000Z", // future, but must be ignored
			last_used_at: "2026-01-01T00:00:00.000Z",
			last_viewed_at: "2026-03-01T00:00:00.000Z",
			last_patched_at: "2026-02-01T00:00:00.000Z",
		};
		expect(latestActivityAt(rec)).toBe("2026-03-01T00:00:00.000Z");
	});

	it("returns null activity for a never-active record", () => {
		expect(latestActivityAt({ created_at: "2026-01-01T00:00:00.000Z" })).toBeNull();
	});
});

describe("skill-usage provenance", () => {
	it("only lists agent-created skills that exist on disk", async () => {
		createSkillFile("agent-one");
		createSkillFile("user-one");
		await markAgentCreated("agent-one");
		// user-one gets telemetry but is never marked agent-created
		await bumpUse("user-one");

		expect(listAgentCreatedSkillNames()).toEqual(["agent-one"]);

		const report = agentCreatedReport();
		expect(report.map((r) => r.name)).toEqual(["agent-one"]);
		expect(report[0]!.created_by).toBe("agent");
	});

	it("forget drops a skill's record", async () => {
		await markAgentCreated("temp");
		expect(getRecord("temp").created_by).toBe("agent");
		await forget("temp");
		expect(getRecord("temp").created_by).toBeNull();
	});
});

describe("skill-usage pin + archive/restore", () => {
	it("pins and unpins via the convenience wrappers", async () => {
		await pinSkill("p");
		expect(getRecord("p").pinned).toBe(true);
	});

	it("archives a skill to .archive/ and restores it", async () => {
		createSkillFile("arch");
		await markAgentCreated("arch");

		const archived = await archiveSkill("arch");
		expect(archived.ok).toBe(true);
		expect(existsSync(join(getSkillsDir(), "arch"))).toBe(false);
		expect(existsSync(join(getSkillsDir(), ".archive", "arch", "SKILL.md"))).toBe(true);
		expect(getRecord("arch").state).toBe("archived");

		const restored = await restoreSkill("arch");
		expect(restored.ok).toBe(true);
		expect(existsSync(join(getSkillsDir(), "arch", "SKILL.md"))).toBe(true);
		expect(getRecord("arch").state).toBe("active");
	});
});
