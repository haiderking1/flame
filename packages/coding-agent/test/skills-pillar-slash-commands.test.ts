import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillInvocationMessage, expandSkillSlashCommand } from "../src/core/skills/slash-commands.ts";

let tempHome: string;
let originalFlameHome: string | undefined;

beforeEach(() => {
	tempHome = mkdtempSync(join(tmpdir(), "flame-slash-skills-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = tempHome;
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	rmSync(tempHome, { recursive: true, force: true });
});

describe("skills pillar slash commands", () => {
	it("expandSkillSlashCommand returns hermes-style activation banner", () => {
		const skillDir = join(tempHome, "skills", "demo");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: demo\ndescription: Demo\n---\nRun ${FLAME_SKILL_DIR}/scripts/foo.sh\n",
		);

		const msg = expandSkillSlashCommand("demo", "extra user note");
		expect(msg).not.toBeNull();
		expect(msg).toContain("[IMPORTANT: The user has invoked");
		expect(msg).toContain("Run ");
		expect(msg).toContain(skillDir);
		expect(msg).not.toContain("<skill ");
		expect(msg).toContain("extra user note");
	});

	it("buildSkillInvocationMessage includes skill directory hint", () => {
		const skillDir = join(tempHome, "skills", "hinted");
		const msg = buildSkillInvocationMessage({ name: "hinted", content: "Body text" }, skillDir);
		expect(msg).toContain("[Skill directory:");
		expect(msg).toContain("hinted");
	});

	it("returns null for unknown skill", () => {
		expect(expandSkillSlashCommand("does-not-exist")).toBeNull();
	});
});
