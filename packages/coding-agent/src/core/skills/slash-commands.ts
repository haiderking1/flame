import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { executeSkillView } from "./skill-view-tool.ts";
import { getSkillsDir } from "./paths.ts";
import { defaultPreprocessingConfig, preprocessSkillContent, type SkillsPreprocessingConfig } from "./preprocessing.ts";

const SKILL_INVALID_CHARS = /[^a-z0-9-]/g;
const SKILL_MULTI_HYPHEN = /-{2,}/g;

export interface BuildSkillInvocationOptions {
	userInstruction?: string;
	runtimeNote?: string;
	sessionId?: string;
	preprocessing?: SkillsPreprocessingConfig;
}

/**
 * Format a loaded skill into a user message payload (hermes _build_skill_message parity).
 */
export function buildSkillInvocationMessage(
	loadedSkill: Record<string, unknown>,
	skillDir: string | null,
	options: BuildSkillInvocationOptions = {},
): string {
	const activationNote =
		`[IMPORTANT: The user has invoked the "${String(loadedSkill.name ?? "skill")}" skill. ` +
		`Follow the skill instructions below as your primary guidance for this turn.]`;

	let content = String(loadedSkill.content ?? "");

	const preprocessCfg = options.preprocessing ?? defaultPreprocessingConfig();
	content = preprocessSkillContent(content, skillDir ?? undefined, options.sessionId, preprocessCfg);

	const parts: string[] = [activationNote, "", content.trim()];

	if (skillDir) {
		parts.push("");
		parts.push(`[Skill directory: ${skillDir}]`);
		parts.push(
			"Resolve any relative paths in this skill (e.g. `scripts/foo.js`, " +
				"`templates/config.yaml`) against that directory, then run them " +
				"with the terminal tool using the absolute path.",
		);
	}

	const linkedFiles = loadedSkill.linked_files as Record<string, string[]> | undefined;
	const supporting: string[] = [];
	if (linkedFiles && typeof linkedFiles === "object") {
		for (const entries of Object.values(linkedFiles)) {
			if (Array.isArray(entries)) {
				supporting.push(...entries);
			}
		}
	}

	if (supporting.length === 0 && skillDir && existsSync(skillDir)) {
		for (const subdir of ["references", "templates", "scripts", "assets"]) {
			const subdirPath = join(skillDir, subdir);
			if (!existsSync(subdirPath)) continue;
			const walk = (dir: string): void => {
				let entries: string[];
				try {
					entries = readdirSync(dir);
				} catch {
					return;
				}
				for (const entry of entries) {
					const full = join(dir, entry);
					try {
						const st = statSync(full);
						if (st.isFile()) {
							supporting.push(relative(skillDir, full).split(/[/\\]/).join("/"));
						} else if (st.isDirectory()) {
							walk(full);
						}
					} catch {}
				}
			};
			walk(subdirPath);
		}
	}

	if (supporting.length > 0 && skillDir) {
		let skillViewTarget = basename(skillDir);
		try {
			skillViewTarget = relative(getSkillsDir(), skillDir).split(/[/\\]/).join("/");
		} catch {}
		parts.push("");
		parts.push("[This skill has supporting files:]");
		for (const sf of supporting) {
			parts.push(`- ${sf}  ->  ${join(skillDir, sf)}`);
		}
		parts.push(
			`\nLoad any of these with skill_view(name="${skillViewTarget}", ` +
				`file_path="<path>"), or run scripts directly by absolute path.`,
		);
	}

	if (options.userInstruction?.trim()) {
		parts.push("");
		parts.push(`The user has provided the following instruction alongside the skill invocation: ${options.userInstruction.trim()}`);
	}

	if (options.runtimeNote?.trim()) {
		parts.push("");
		parts.push(`[Runtime note: ${options.runtimeNote.trim()}]`);
	}

	return parts.join("\n");
}

/**
 * Load a skill by name and build the hermes-style user message for slash invocation.
 */
export function expandSkillSlashCommand(
	skillName: string,
	userArgs = "",
	options: BuildSkillInvocationOptions = {},
): string | null {
	const result = executeSkillView({ name: skillName }, { preprocess: false });
	if (!result.success) {
		return null;
	}
	const skillDir = typeof result.skill_dir === "string" ? result.skill_dir : null;
	const message = buildSkillInvocationMessage(result as Record<string, unknown>, skillDir, {
		...options,
		userInstruction: userArgs || options.userInstruction,
	});
	return message;
}

/** Normalize skill name to slash slug (hermes parity). */
export function skillNameToSlashSlug(name: string): string {
	let cmd = name.toLowerCase().replace(/ /g, "-").replace(/_/g, "-");
	cmd = cmd.replace(SKILL_INVALID_CHARS, "");
	cmd = cmd.replace(SKILL_MULTI_HYPHEN, "-").replace(/^-+|-+$/g, "");
	return cmd;
}
