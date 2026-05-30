import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSkillsList } from "../src/core/skills/skills-list-tool.ts";

describe("skills pillar skills-list", () => {
	const originalFlameHome = process.env.FLAME_HOME;
	let tempHome: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "flame-skills-list-"));
		process.env.FLAME_HOME = tempHome;
	});

	afterEach(() => {
		if (originalFlameHome === undefined) {
			delete process.env.FLAME_HOME;
		} else {
			process.env.FLAME_HOME = originalFlameHome;
		}
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("returns empty library message when no skills", () => {
		const result = executeSkillsList({});
		expect(result.success).toBe(true);
		expect(result.count).toBe(0);
		expect(String(result.message ?? "")).toContain("No skills found");
	});

	it("lists skills with metadata", () => {
		mkdirSync(join(tempHome, "skills", "devops", "deploy"), { recursive: true });
		writeFileSync(
			join(tempHome, "skills", "devops", "deploy", "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy services\n---\n",
		);

		const result = executeSkillsList({});
		expect(result.success).toBe(true);
		expect(result.count).toBe(1);
		const skills = result.skills as Array<{ name: string; category: string }>;
		expect(skills[0]?.name).toBe("deploy");
		expect(skills[0]?.category).toBe("devops");
		expect(result.categories).toContain("devops");
	});

	it("filters by category", () => {
		mkdirSync(join(tempHome, "skills", "a", "one"), { recursive: true });
		mkdirSync(join(tempHome, "skills", "b", "two"), { recursive: true });
		writeFileSync(join(tempHome, "skills", "a", "one", "SKILL.md"), "---\nname: one\ndescription: One\n---\n");
		writeFileSync(join(tempHome, "skills", "b", "two", "SKILL.md"), "---\nname: two\ndescription: Two\n---\n");

		const result = executeSkillsList({ category: "a" });
		expect(result.count).toBe(1);
		const skills = result.skills as Array<{ name: string }>;
		expect(skills[0]?.name).toBe("one");
	});
});
