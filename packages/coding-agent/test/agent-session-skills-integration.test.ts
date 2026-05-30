/**
 * Integration: skill_manage writes disk; fresh session system prompt includes index;
 * skill_view returns preprocessed body.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillsSystemPromptSync } from "../src/core/skills/prompt-index.ts";
import { executeSkillManage } from "../src/core/skills/skill-manage-actions.ts";
import { executeSkillView } from "../src/core/skills/skill-view-tool.ts";
import { createHarnessWithExtensions } from "./test-harness.ts";

const SKILL_CONTENT = `---
name: integration-skill
description: Integration test skill
---
Use \${FLAME_SKILL_DIR}/scripts/foo.sh
`;

let flameHomeTemp: string;
let originalFlameHome: string | undefined;

beforeEach(() => {
	flameHomeTemp = mkdtempSync(join(tmpdir(), "flame-skills-integration-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = flameHomeTemp;
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	if (flameHomeTemp) {
		rmSync(flameHomeTemp, { recursive: true, force: true });
		flameHomeTemp = "";
	}
});

describe("AgentSession skills integration", () => {
	it("create skill on disk, index in prompt, skill_view substitutes FLAME_SKILL_DIR", async () => {
		const createResult = await executeSkillManage({
			action: "create",
			name: "integration-skill",
			content: SKILL_CONTENT,
		});
		expect(createResult.success).toBe(true);

		const skillMd = join(flameHomeTemp, "skills", "integration-skill", "SKILL.md");
		expect(existsSync(skillMd)).toBe(true);

		const toolSet = new Set(["skills_list", "skill_view", "skill_manage"]);
		const indexBlock = buildSkillsSystemPromptSync({ availableTools: toolSet });
		expect(indexBlock).toContain("integration-skill");
		expect(indexBlock).toContain("<available_skills>");

		const harness = await createHarnessWithExtensions();

		try {
			await harness.session.ready();
			const prompt = harness.session.agent.state.systemPrompt;
			expect(prompt).toContain("integration-skill");
			expect(prompt).toContain("Skills (mandatory)");
		} finally {
			harness.cleanup();
		}

		const view = executeSkillView({ name: "integration-skill" });
		expect(view.success).toBe(true);
		const skillDir = String(view.skill_dir);
		expect(String(view.content)).toContain(skillDir);
		expect(String(view.content)).not.toContain("${FLAME_SKILL_DIR}");
	});
});
