import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	isExcludedSkillPath,
	iterSkillIndexFiles,
	loadSkills,
	loadSkillsFromDir,
} from "../src/core/skills/discovery.ts";
import { skillMatchesPlatform } from "../src/core/skills/frontmatter.ts";
import { getSkillsDir } from "../src/core/skills/paths.ts";

describe("skills pillar discovery", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "flame-skills-discovery-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("iterSkillIndexFiles excludes node_modules and .git", () => {
		const root = join(tempDir, "skills-root");
		mkdirSync(join(root, "github", "my-skill"), { recursive: true });
		writeFileSync(
			join(root, "github", "my-skill", "SKILL.md"),
			"---\nname: my-skill\ndescription: test\n---\nbody",
		);
		mkdirSync(join(root, "node_modules", "pkg", "nested-skill"), { recursive: true });
		writeFileSync(
			join(root, "node_modules", "pkg", "nested-skill", "SKILL.md"),
			"---\nname: nested\ndescription: hidden\n---\n",
		);

		const found = [...iterSkillIndexFiles(root, "SKILL.md")];
		expect(found).toHaveLength(1);
		expect(found[0]).toContain("my-skill");
	});

	it("isExcludedSkillPath detects excluded directory components", () => {
		expect(isExcludedSkillPath("/foo/node_modules/bar/SKILL.md")).toBe(true);
		expect(isExcludedSkillPath("/foo/github/bar/SKILL.md")).toBe(false);
	});

	it("skillMatchesPlatform respects platforms frontmatter", () => {
		expect(skillMatchesPlatform({ platforms: ["windows"] })).toBe(process.platform === "win32");
		expect(skillMatchesPlatform({})).toBe(true);
	});

	it("loadSkillsFromDir assigns category from path", () => {
		const root = join(tempDir, "cat-skill");
		mkdirSync(join(root, "devops", "deploy"), { recursive: true });
		writeFileSync(
			join(root, "devops", "deploy", "SKILL.md"),
			"---\nname: deploy\ndescription: Deploy things\n---\n",
		);
		const { skills } = loadSkillsFromDir({ dir: root, source: "test", skillsRoot: root });
		expect(skills).toHaveLength(1);
		expect(skills[0]?.category).toBe("devops");
	});

	it("loadSkills scans FLAME_HOME/skills and legacy agentDir but not .flame/skills", () => {
		const originalFlameHome = process.env.FLAME_HOME;
		const flameHome = join(tempDir, "flame-home");
		const agentDir = join(tempDir, "agent");
		const cwd = join(tempDir, "project");
		process.env.FLAME_HOME = flameHome;

		mkdirSync(join(flameHome, "skills", "global-skill"), { recursive: true });
		writeFileSync(
			join(flameHome, "skills", "global-skill", "SKILL.md"),
			"---\nname: global-skill\ndescription: global\n---\n",
		);

		mkdirSync(join(agentDir, "skills", "legacy-skill"), { recursive: true });
		writeFileSync(
			join(agentDir, "skills", "legacy-skill", "SKILL.md"),
			"---\nname: legacy-skill\ndescription: legacy\n---\n",
		);

		mkdirSync(join(cwd, ".flame", "skills", "project-skill"), { recursive: true });
		writeFileSync(
			join(cwd, ".flame", "skills", "project-skill", "SKILL.md"),
			"---\nname: project-skill\ndescription: project\n---\n",
		);

		const { skills } = loadSkills({
			cwd,
			agentDir,
			skillPaths: [],
			includeDefaults: true,
		});

		const names = skills.map((s) => s.name).sort();
		expect(names).toContain("global-skill");
		expect(names).toContain("legacy-skill");
		expect(names).not.toContain("project-skill");

		if (originalFlameHome === undefined) {
			delete process.env.FLAME_HOME;
		} else {
			process.env.FLAME_HOME = originalFlameHome;
		}
	});

	it("getSkillsDir matches loadSkills primary root", () => {
		expect(getSkillsDir()).toContain("skills");
	});
});
