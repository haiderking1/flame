import { spawnSync } from "node:child_process";
import { INLINE_SHELL_MAX_OUTPUT } from "./constants.ts";

const SKILL_TEMPLATE_RE = /\$\{(FLAME_SKILL_DIR|FLAME_SESSION_ID)\}/g;
const INLINE_SHELL_RE = /!`([^`\n]+)`/g;

export interface SkillsPreprocessingConfig {
	templateVars?: boolean;
	inlineShell?: boolean;
	inlineShellTimeout?: number;
}

export function defaultInlineShellEnabled(): boolean {
	if (process.platform === "win32") {
		if (process.env.WSL_DISTRO_NAME) {
			return true;
		}
		return false;
	}
	return false;
}

export function defaultPreprocessingConfig(): SkillsPreprocessingConfig {
	return {
		templateVars: true,
		inlineShell: defaultInlineShellEnabled(),
		inlineShellTimeout: 10,
	};
}

export function substituteTemplateVars(
	content: string,
	skillDir: string | undefined,
	sessionId: string | undefined,
): string {
	if (!content) {
		return content;
	}

	const skillDirStr = skillDir ?? null;

	return content.replace(SKILL_TEMPLATE_RE, (match, token: string) => {
		if (token === "FLAME_SKILL_DIR" && skillDirStr) {
			return skillDirStr;
		}
		if (token === "FLAME_SESSION_ID" && sessionId) {
			return sessionId;
		}
		return match;
	});
}

export function runInlineShell(command: string, cwd: string | undefined, timeoutSec: number): string {
	try {
		const result = spawnSync("bash", ["-c", command], {
			cwd: cwd,
			encoding: "utf-8",
			timeout: Math.max(1, timeoutSec) * 1000,
			maxBuffer: INLINE_SHELL_MAX_OUTPUT * 2,
		});
		if (result.error) {
			if ("code" in result.error && result.error.code === "ENOENT") {
				return "[inline-shell error: bash not found]";
			}
			return `[inline-shell error: ${result.error.message}]`;
		}
		let output = (result.stdout ?? "").replace(/\n$/, "");
		if (!output && result.stderr) {
			output = result.stderr.replace(/\n$/, "");
		}
		if (output.length > INLINE_SHELL_MAX_OUTPUT) {
			return `${output.slice(0, INLINE_SHELL_MAX_OUTPUT)}...[truncated]`;
		}
		return output;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("ETIMEDOUT") || message.includes("timed out")) {
			return `[inline-shell timeout after ${timeoutSec}s: ${command}]`;
		}
		return `[inline-shell error: ${message}]`;
	}
}

export function expandInlineShell(content: string, skillDir: string | undefined, timeoutSec: number): string {
	if (!content.includes("!`")) {
		return content;
	}

	return content.replace(INLINE_SHELL_RE, (_match, cmd: string) => {
		const trimmed = cmd.trim();
		if (!trimmed) {
			return "";
		}
		return runInlineShell(trimmed, skillDir, timeoutSec);
	});
}

export function preprocessSkillContent(
	content: string,
	skillDir: string | undefined,
	sessionId?: string,
	config?: SkillsPreprocessingConfig,
): string {
	if (!content) {
		return content;
	}

	const cfg = config ?? defaultPreprocessingConfig();
	let result = content;
	if (cfg.templateVars !== false) {
		result = substituteTemplateVars(result, skillDir, sessionId);
	}
	if (cfg.inlineShell === true) {
		const timeout = cfg.inlineShellTimeout ?? 10;
		result = expandInlineShell(result, skillDir, timeout);
	}
	return result;
}
