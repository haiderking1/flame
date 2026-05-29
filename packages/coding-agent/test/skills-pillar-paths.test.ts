import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getLegacyAgentSkillsDir,
	getSkillBundlesDir,
	getSkillsDir,
	getSkillsPromptSnapshotPath,
} from "../src/core/skills/paths.ts";

describe("skills pillar paths", () => {
	const originalFlameHome = process.env.FLAME_HOME;
	let tempHome: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "flame-skills-paths-"));
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

	it("getSkillsDir resolves under FLAME_HOME", () => {
		expect(getSkillsDir()).toBe(join(tempHome, "skills"));
	});

	it("getSkillBundlesDir resolves under FLAME_HOME", () => {
		expect(getSkillBundlesDir()).toBe(join(tempHome, "skill-bundles"));
	});

	it("getSkillsPromptSnapshotPath resolves under FLAME_HOME", () => {
		expect(getSkillsPromptSnapshotPath()).toBe(join(tempHome, ".skills_prompt_snapshot.json"));
	});

	it("getLegacyAgentSkillsDir resolves under agentDir", () => {
		expect(getLegacyAgentSkillsDir("/tmp/agent")).toBe(join("/tmp/agent", "skills"));
	});

	it("uses FLAME_HOME env var when set", () => {
		mkdirSync(join(tempHome, "skills"), { recursive: true });
		writeFileSync(join(tempHome, "skills", ".gitkeep"), "");
		expect(getSkillsDir()).toContain(tempHome);
	});
});
