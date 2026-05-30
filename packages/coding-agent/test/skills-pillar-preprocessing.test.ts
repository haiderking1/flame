import { describe, expect, it } from "vitest";
import {
	defaultInlineShellEnabled,
	expandInlineShell,
	preprocessSkillContent,
	substituteTemplateVars,
} from "../src/core/skills/preprocessing.ts";

describe("skills pillar preprocessing", () => {
	it("substitutes FLAME_SKILL_DIR when skill dir provided", () => {
		const result = substituteTemplateVars("Path: ${FLAME_SKILL_DIR}", "/tmp/skill", undefined);
		expect(result).toBe("Path: /tmp/skill");
	});

	it("substitutes FLAME_SESSION_ID when session id provided", () => {
		const result = substituteTemplateVars("Session: ${FLAME_SESSION_ID}", undefined, "sess-123");
		expect(result).toBe("Session: sess-123");
	});

	it("leaves unresolved tokens in place", () => {
		const result = substituteTemplateVars("Session: ${FLAME_SESSION_ID}", undefined, undefined);
		expect(result).toBe("Session: ${FLAME_SESSION_ID}");
	});

	it("does not expand inline shell by default on Windows", () => {
		if (process.platform !== "win32") {
			return;
		}
		expect(defaultInlineShellEnabled()).toBe(false);
		const result = preprocessSkillContent("Today is !`echo hello`", "/tmp/skill");
		expect(result).toBe("Today is !`echo hello`");
	});

	it("expands inline shell when explicitly enabled", () => {
		const content = "Value: !`echo test-value`";
		const result = expandInlineShell(content, undefined, 5);
		if (process.platform === "win32" && !process.env.WSL_DISTRO_NAME) {
			const hasShellOutput = result.includes("test-value");
			const hasShellError = result.includes("[inline-shell");
			expect(hasShellOutput || hasShellError).toBe(true);
		} else {
			expect(result).toContain("test-value");
		}
	});

	it("preprocessSkillContent applies template vars before optional shell", () => {
		const result = preprocessSkillContent("Dir=${FLAME_SKILL_DIR}", "/my/skill", undefined, {
			templateVars: true,
			inlineShell: false,
		});
		expect(result).toBe("Dir=/my/skill");
	});
});
