import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills/discovery.ts";
import { getSkillsDir } from "../src/core/skills/paths.ts";
import { resetSkillsPromptCacheForTests } from "../src/core/skills/prompt-index.ts";
import { executeSkillManage } from "../src/core/skills/skill-manage-actions.ts";

const VALID_SKILL = `---
name: test-skill
description: A test skill for manage tool
---
Do step one, then step two.
`;

const OVERSIZE_BODY = "x".repeat(100_001);

let tempHome: string;
let originalFlameHome: string | undefined;

beforeEach(() => {
	tempHome = mkdtempSync(join(tmpdir(), "flame-skill-manage-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = tempHome;
	resetSkillsPromptCacheForTests();
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	rmSync(tempHome, { recursive: true, force: true });
});

describe("skills pillar skill_manage", () => {
	it("create happy path writes SKILL.md under FLAME_HOME/skills", async () => {
		const result = await executeSkillManage({
			action: "create",
			name: "test-skill",
			content: VALID_SKILL,
			category: "dev",
		});
		expect(result.success).toBe(true);
		const skillMd = join(tempHome, "skills", "dev", "test-skill", "SKILL.md");
		expect(existsSync(skillMd)).toBe(true);
		expect(readFileSync(skillMd, "utf-8")).toContain("Do step one");
	});

	it("create rejects name collision", async () => {
		await executeSkillManage({ action: "create", name: "dup", content: VALID_SKILL.replace("test-skill", "dup") });
		const second = await executeSkillManage({
			action: "create",
			name: "dup",
			content: VALID_SKILL.replace("test-skill", "dup"),
		});
		expect(second.success).toBe(false);
		expect(String(second.error)).toContain("already exists");
	});

	it("create rejects oversize content", async () => {
		const huge = `---\nname: big\ndescription: x\n---\n${OVERSIZE_BODY}`;
		const result = await executeSkillManage({ action: "create", name: "big", content: huge });
		expect(result.success).toBe(false);
		expect(String(result.error)).toContain("limit");
	});

	it("create rejects invalid frontmatter", async () => {
		const result = await executeSkillManage({
			action: "create",
			name: "bad-fm",
			content: "no frontmatter here",
		});
		expect(result.success).toBe(false);
		expect(String(result.error)).toContain("frontmatter");
	});

	it("edit replaces full SKILL.md", async () => {
		await executeSkillManage({
			action: "create",
			name: "edit-me",
			content: VALID_SKILL.replace("test-skill", "edit-me"),
		});
		const updated = VALID_SKILL.replace("test-skill", "edit-me").replace("step two", "step three");
		const result = await executeSkillManage({ action: "edit", name: "edit-me", content: updated });
		expect(result.success).toBe(true);
		const body = readFileSync(join(tempHome, "skills", "edit-me", "SKILL.md"), "utf-8");
		expect(body).toContain("step three");
	});

	it("patch happy path", async () => {
		await executeSkillManage({
			action: "create",
			name: "patch-me",
			content: VALID_SKILL.replace("test-skill", "patch-me"),
		});
		const result = await executeSkillManage({
			action: "patch",
			name: "patch-me",
			old_string: "step one",
			new_string: "phase one",
		});
		expect(result.success).toBe(true);
		expect(readFileSync(join(tempHome, "skills", "patch-me", "SKILL.md"), "utf-8")).toContain("phase one");
	});

	it("patch errors when old_string not found", async () => {
		await executeSkillManage({
			action: "create",
			name: "no-match",
			content: VALID_SKILL.replace("test-skill", "no-match"),
		});
		const result = await executeSkillManage({
			action: "patch",
			name: "no-match",
			old_string: "nonexistent unique string xyz",
			new_string: "replacement",
		});
		expect(result.success).toBe(false);
		expect(String(result.error)).toMatch(/find|match/i);
	});

	it("patch errors on multiple matches without replace_all", async () => {
		const content = `---
name: multi
description: multi match
---
alpha beta alpha
`;
		await executeSkillManage({ action: "create", name: "multi", content });
		const result = await executeSkillManage({
			action: "patch",
			name: "multi",
			old_string: "alpha",
			new_string: "gamma",
		});
		expect(result.success).toBe(false);
		expect(String(result.error)).toContain("occurrences");
	});

	it("patch with replace_all", async () => {
		const content = `---
name: multi-all
description: all
---
alpha beta alpha
`;
		await executeSkillManage({ action: "create", name: "multi-all", content });
		const result = await executeSkillManage({
			action: "patch",
			name: "multi-all",
			old_string: "alpha",
			new_string: "gamma",
			replace_all: true,
		});
		expect(result.success).toBe(true);
		expect(readFileSync(join(tempHome, "skills", "multi-all", "SKILL.md"), "utf-8")).not.toContain("alpha");
	});

	it("delete removes skill directory", async () => {
		await executeSkillManage({ action: "create", name: "gone", content: VALID_SKILL.replace("test-skill", "gone") });
		const result = await executeSkillManage({ action: "delete", name: "gone" });
		expect(result.success).toBe(true);
		expect(existsSync(join(tempHome, "skills", "gone"))).toBe(false);
	});

	it("write_file and remove_file", async () => {
		await executeSkillManage({
			action: "create",
			name: "files",
			content: VALID_SKILL.replace("test-skill", "files"),
		});
		const write = await executeSkillManage({
			action: "write_file",
			name: "files",
			file_path: "references/note.md",
			file_content: "# Note\n",
		});
		expect(write.success).toBe(true);
		const refPath = join(tempHome, "skills", "files", "references", "note.md");
		expect(existsSync(refPath)).toBe(true);

		const remove = await executeSkillManage({
			action: "remove_file",
			name: "files",
			file_path: "references/note.md",
		});
		expect(remove.success).toBe(true);
		expect(existsSync(refPath)).toBe(false);
	});

	it("write_file rejects path traversal", async () => {
		await executeSkillManage({
			action: "create",
			name: "secure",
			content: VALID_SKILL.replace("test-skill", "secure"),
		});
		const result = await executeSkillManage({
			action: "write_file",
			name: "secure",
			file_path: "../SKILL.md",
			file_content: "evil",
		});
		expect(result.success).toBe(false);
		expect(String(result.error)).toMatch(/traversal|allowed/i);
	});

	it("round-trip: create then loadSkills sees it; delete then gone", async () => {
		await executeSkillManage({
			action: "create",
			name: "roundtrip",
			content: VALID_SKILL.replace("test-skill", "roundtrip"),
		});
		const loaded = loadSkillsFromDir({ dir: getSkillsDir(), source: "flame-home" });
		expect(loaded.skills.some((s) => s.name === "roundtrip")).toBe(true);

		await executeSkillManage({ action: "delete", name: "roundtrip" });
		const after = loadSkillsFromDir({ dir: getSkillsDir(), source: "flame-home" });
		expect(after.skills.some((s) => s.name === "roundtrip")).toBe(false);
	});
});
