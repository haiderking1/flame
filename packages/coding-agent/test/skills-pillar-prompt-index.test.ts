import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildSkillsSystemPrompt,
	clearSkillsSystemPromptCache,
	getSkillsPromptCacheSize,
	resetSkillsPromptCacheForTests,
} from "../src/core/skills/prompt-index.ts";
import { SKILLS_GUIDANCE } from "../src/core/skills/prompt-strings.ts";
import { getSkillsPromptSnapshotPath } from "../src/core/skills/paths.ts";

describe("skills pillar prompt-index", () => {
	const originalFlameHome = process.env.FLAME_HOME;
	let tempHome: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "flame-skills-prompt-"));
		process.env.FLAME_HOME = tempHome;
		resetSkillsPromptCacheForTests();
		clearSkillsSystemPromptCache({ clearSnapshot: true });
	});

	afterEach(() => {
		clearSkillsSystemPromptCache({ clearSnapshot: true });
		if (originalFlameHome === undefined) {
			delete process.env.FLAME_HOME;
		} else {
			process.env.FLAME_HOME = originalFlameHome;
		}
		rmSync(tempHome, { recursive: true, force: true });
	});

	it("returns empty string when no skills exist", async () => {
		const result = await buildSkillsSystemPrompt();
		expect(result).toBe("");
	});

	it("builds categorical index with skill_view guidance", async () => {
		mkdirSync(join(tempHome, "skills", "github", "code-review"), { recursive: true });
		writeFileSync(
			join(tempHome, "skills", "github", "DESCRIPTION.md"),
			"---\ndescription: GitHub workflows\n---\n",
		);
		writeFileSync(
			join(tempHome, "skills", "github", "code-review", "SKILL.md"),
			"---\nname: code-review\ndescription: Review pull requests carefully\n---\n# Review\n",
		);

		const result = await buildSkillsSystemPrompt();
		expect(result).toContain("## Skills (mandatory)");
		expect(result).toContain("skill_view(name)");
		expect(result).toContain("<available_skills>");
		expect(result).toContain("github: GitHub workflows");
		expect(result).toContain("- code-review:");
	});

	it("writes disk snapshot on cold scan", async () => {
		mkdirSync(join(tempHome, "skills", "solo"), { recursive: true });
		writeFileSync(
			join(tempHome, "skills", "solo", "SKILL.md"),
			"---\nname: solo\ndescription: Solo skill\n---\n",
		);

		await buildSkillsSystemPrompt();
		const snapshotPath = getSkillsPromptSnapshotPath();
		expect(readFileSync(snapshotPath, "utf-8")).toContain("solo");
	});

	it("LRU cache returns same result without rescanning", async () => {
		mkdirSync(join(tempHome, "skills", "cached"), { recursive: true });
		writeFileSync(
			join(tempHome, "skills", "cached", "SKILL.md"),
			"---\nname: cached\ndescription: Cached skill\n---\n",
		);

		const first = await buildSkillsSystemPrompt();
		const second = await buildSkillsSystemPrompt();
		expect(first).toBe(second);
		expect(getSkillsPromptCacheSize()).toBeGreaterThan(0);
	});

	it("filters skills by conditional requires_tools", async () => {
		mkdirSync(join(tempHome, "skills", "conditional"), { recursive: true });
		writeFileSync(
			join(tempHome, "skills", "conditional", "SKILL.md"),
			`---
name: conditional
description: Needs memory tool
metadata:
  hermes:
    requires_tools: [memory]
---
`,
		);

		const without = await buildSkillsSystemPrompt({ availableTools: new Set() });
		expect(without).toBe("");

		const withTool = await buildSkillsSystemPrompt({ availableTools: new Set(["memory"]) });
		expect(withTool).toContain("conditional");
	});

	it("SKILLS_GUIDANCE mentions skill_manage", () => {
		expect(SKILLS_GUIDANCE).toContain("skill_manage");
	});
});
