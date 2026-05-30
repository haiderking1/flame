import { type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { EXCLUDED_SKILL_DIRS, INJECTION_PATTERNS } from "./constants.ts";
import { getCategoryFromSkillPath, isExcludedSkillPath, iterSkillIndexFiles } from "./discovery.ts";
import { extractRelatedSkills, extractSkillTags, skillMatchesPlatform } from "./frontmatter.ts";
import { hasTraversalComponent, isPathWithinDir, validateWithinDir } from "./path-security.ts";
import { getSkillsDir } from "./paths.ts";
import { preprocessSkillContent } from "./preprocessing.ts";
import type { SkillFrontmatter } from "./types.ts";

const skillViewSchema = Type.Object({
	name: Type.String({
		description:
			"The skill name (use skills_list to see available skills). For categorized skills, use 'category/skill-name'.",
	}),
	file_path: Type.Optional(
		Type.String({
			description:
				"OPTIONAL: Path to a linked file within the skill (e.g., 'references/api.md'). Omit to get SKILL.md content.",
		}),
	),
});

export type SkillViewInput = Static<typeof skillViewSchema>;

export interface SkillViewToolDetails {
	name: string;
	success: boolean;
	filePath?: string;
	error?: string;
}

const SKILL_VIEW_DESCRIPTION =
	"Skills allow for loading information about specific tasks and workflows, as well as scripts and templates. " +
	"Load a skill's full content or access its linked files (references, templates, scripts). " +
	"First call returns SKILL.md content plus a 'linked_files' dict showing available references/templates/scripts. " +
	"To access those, call again with file_path parameter.";

export interface SkillViewToolOptions {
	externalDirs?: string[];
	sessionId?: string;
	preprocess?: boolean;
	disabledNames?: Set<string>;
}

interface SkillCandidate {
	skillDir: string | null;
	skillMd: string;
}

function getTrustedDirs(externalDirs: string[]): string[] {
	const dirs: string[] = [];
	const primary = getSkillsDir();
	if (existsSync(primary)) {
		dirs.push(resolve(primary));
	}
	for (const ext of externalDirs) {
		if (existsSync(ext)) {
			dirs.push(resolve(ext));
		}
	}
	return dirs;
}

function recordCandidate(
	candidates: SkillCandidate[],
	seen: Set<string>,
	skillDir: string | null,
	skillMd: string,
): void {
	const key = resolve(skillMd);
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	candidates.push({ skillDir, skillMd });
}

function findSkillCandidates(name: string, externalDirs: string[]): SkillCandidate[] {
	const candidates: SkillCandidate[] = [];
	const seen = new Set<string>();
	const allDirs: string[] = [];
	const skillsDir = getSkillsDir();
	if (existsSync(skillsDir)) {
		allDirs.push(skillsDir);
	}
	for (const ext of externalDirs) {
		if (existsSync(ext)) {
			allDirs.push(ext);
		}
	}

	let localCategoryName: string | null = null;
	if (name.includes(":")) {
		const colonIdx = name.indexOf(":");
		const ns = name.slice(0, colonIdx);
		const bare = name.slice(colonIdx + 1);
		if (bare) {
			localCategoryName = `${ns}/${bare}`;
		}
	}

	for (const searchDir of allDirs) {
		const directPath = join(searchDir, name);
		if (existsSync(directPath)) {
			const stats = statSync(directPath);
			if (stats.isDirectory() && existsSync(join(directPath, "SKILL.md"))) {
				recordCandidate(candidates, seen, directPath, join(directPath, "SKILL.md"));
			} else if (directPath.endsWith(".md") && stats.isFile()) {
				recordCandidate(candidates, seen, null, directPath);
			} else if (existsSync(`${directPath}.md`)) {
				recordCandidate(candidates, seen, null, `${directPath}.md`);
			}
		}

		if (localCategoryName) {
			const categorizedPath = join(searchDir, localCategoryName);
			if (existsSync(categorizedPath)) {
				const stats = statSync(categorizedPath);
				if (stats.isDirectory() && existsSync(join(categorizedPath, "SKILL.md"))) {
					recordCandidate(candidates, seen, categorizedPath, join(categorizedPath, "SKILL.md"));
				} else if (existsSync(`${categorizedPath}.md`)) {
					recordCandidate(candidates, seen, null, `${categorizedPath}.md`);
				}
			}
		}

		for (const foundSkillMd of iterSkillIndexFiles(searchDir, "SKILL.md")) {
			if (isExcludedSkillPath(foundSkillMd)) continue;
			if (basename(dirname(foundSkillMd)) === name) {
				recordCandidate(candidates, seen, dirname(foundSkillMd), foundSkillMd);
			}
		}

		function walkForLegacyFlat(dir: string): void {
			let entries: Dirent[];
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.isDirectory()) {
					if (!EXCLUDED_SKILL_DIRS.has(entry.name)) {
						walkForLegacyFlat(join(dir, entry.name));
					}
					continue;
				}
				if (entry.name === `${name}.md` && entry.name !== "SKILL.md") {
					recordCandidate(candidates, seen, null, join(dir, entry.name));
				}
			}
		}
		walkForLegacyFlat(searchDir);
	}

	return candidates;
}

function scanLinkedFiles(skillDir: string): Record<string, string[]> {
	const linked: Record<string, string[]> = {
		references: [],
		templates: [],
		assets: [],
		scripts: [],
		other: [],
	};

	function walk(dir: string): void {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (entry.name === "SKILL.md") continue;
			const rel = relative(skillDir, full).split("\\").join("/");
			if (rel.startsWith("references/")) {
				linked.references!.push(rel);
			} else if (rel.startsWith("templates/")) {
				linked.templates!.push(rel);
			} else if (rel.startsWith("assets/")) {
				linked.assets!.push(rel);
			} else if (rel.startsWith("scripts/")) {
				linked.scripts!.push(rel);
			} else if (/\.(md|py|yaml|yml|json|tex|sh)$/i.test(entry.name)) {
				linked.other!.push(rel);
			}
		}
	}

	walk(skillDir);
	const filtered: Record<string, string[]> = {};
	for (const [key, values] of Object.entries(linked)) {
		if (values.length > 0) {
			filtered[key] = values;
		}
	}
	return filtered;
}

function listAvailableFiles(skillDir: string): Record<string, string[]> {
	return scanLinkedFiles(skillDir);
}

export function executeSkillView(args: SkillViewInput, options: SkillViewToolOptions = {}): Record<string, unknown> {
	const externalDirs = options.externalDirs ?? [];
	const disabled = options.disabledNames ?? new Set<string>();
	const name = args.name.trim();
	const filePath = args.file_path?.trim();

	if (!name) {
		return { success: false, error: "Skill name is required." };
	}

	const allDirs = getTrustedDirs(externalDirs);
	if (allDirs.length === 0) {
		try {
			mkdirSync(getSkillsDir(), { recursive: true });
		} catch {}
		return {
			success: false,
			error: "Skills directory does not exist yet. It will be created when you add your first skill.",
		};
	}

	const candidates = findSkillCandidates(name, externalDirs);

	if (candidates.length > 1) {
		const paths = candidates.map((c) => c.skillMd);
		return {
			success: false,
			error: `Ambiguous skill name '${name}': ${candidates.length} skills match. Refusing to guess.`,
			matches: paths,
			hint: "Pass the full relative path instead of the bare name (e.g., 'category/skill-name').",
		};
	}

	if (candidates.length === 0) {
		return {
			success: false,
			error: `Skill '${name}' not found.`,
			hint: "Use skills_list to see all available skills",
		};
	}

	const { skillDir, skillMd } = candidates[0]!;
	const resolvedSkillDir = skillDir ?? dirname(skillMd);

	let content: string;
	try {
		content = readFileSync(skillMd, "utf-8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { success: false, error: `Failed to read skill '${name}': ${message}` };
	}

	let outsideTrusted = true;
	for (const trusted of allDirs) {
		if (isPathWithinDir(skillMd, trusted)) {
			outsideTrusted = false;
			break;
		}
	}

	const contentLower = content.toLowerCase();
	const injectionDetected = INJECTION_PATTERNS.some((p) => contentLower.includes(p));
	const warnings: string[] = [];
	if (outsideTrusted) {
		warnings.push(`skill file is outside the trusted skills directory (${getSkillsDir()}): ${skillMd}`);
	}
	if (injectionDetected) {
		warnings.push("skill content contains patterns that may indicate prompt injection");
	}

	let frontmatter: SkillFrontmatter = {};
	try {
		const parsed = parseFrontmatter<SkillFrontmatter>(content);
		frontmatter = parsed.frontmatter;
	} catch {}

	if (!skillMatchesPlatform(frontmatter)) {
		return {
			success: false,
			error: `Skill '${name}' is not supported on this platform.`,
		};
	}

	const resolvedName = String(frontmatter.name ?? basename(resolvedSkillDir));
	if (disabled.has(resolvedName)) {
		return {
			success: false,
			error: `Skill '${resolvedName}' is disabled.`,
		};
	}

	if (filePath && skillDir) {
		if (hasTraversalComponent(filePath)) {
			return {
				success: false,
				error: "Path traversal ('..') is not allowed.",
				hint: "Use a relative path within the skill directory",
			};
		}
		const traversalError = validateWithinDir(filePath, skillDir);
		if (traversalError) {
			return {
				success: false,
				error: traversalError,
				hint: "Use a relative path within the skill directory",
			};
		}
		const targetFile = join(skillDir, filePath);
		if (!existsSync(targetFile)) {
			return {
				success: false,
				error: `File '${filePath}' not found in skill '${name}'.`,
				available_files: listAvailableFiles(skillDir),
			};
		}
		let fileContent: string;
		try {
			fileContent = readFileSync(targetFile, "utf-8");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { success: false, error: `Failed to read file: ${message}` };
		}
		return {
			success: true,
			name: resolvedName,
			file: filePath,
			content: fileContent,
			skill_dir: skillDir,
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	}

	const { frontmatter: fm, body } = parseFrontmatter<SkillFrontmatter>(content);
	const rawBody = body;
	const shouldPreprocess = options.preprocess !== false;
	const processedBody = shouldPreprocess
		? preprocessSkillContent(rawBody, resolvedSkillDir, options.sessionId)
		: rawBody;

	const skillsRoot = getSkillsDir();
	const category = existsSync(skillsRoot) ? getCategoryFromSkillPath(skillMd, skillsRoot) : "general";
	const linkedFiles = scanLinkedFiles(resolvedSkillDir);
	const tags = extractSkillTags(fm);
	const relatedSkills = extractRelatedSkills(fm);

	return {
		success: true,
		name: resolvedName,
		description: fm.description ?? "",
		category,
		content: processedBody,
		raw_content: rawBody,
		skill_dir: resolvedSkillDir,
		linked_files: Object.keys(linkedFiles).length > 0 ? linkedFiles : undefined,
		tags,
		related_skills: relatedSkills,
		warnings: warnings.length > 0 ? warnings : undefined,
		usage_hint:
			Object.keys(linkedFiles).length > 0
				? "To view linked files, call skill_view(name, file_path) where file_path is e.g. 'references/api.md'"
				: undefined,
	};
}

export function createSkillViewToolDefinition(
	options: SkillViewToolOptions = {},
): ToolDefinition<typeof skillViewSchema, SkillViewToolDetails> {
	return {
		name: "skill_view",
		label: "skill_view",
		description: SKILL_VIEW_DESCRIPTION,
		promptSnippet: "Load a skill's full SKILL.md body or supporting files",
		promptGuidelines: [],
		parameters: skillViewSchema,

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const name = args?.name ?? "";
			const file = args?.file_path ? ` ${theme.fg("muted", args.file_path)}` : "";
			text.setText(`${theme.fg("toolTitle", theme.bold("skill_view"))} ${theme.fg("accent", name)}${file}`);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as SkillViewToolDetails | undefined;
			if (context.isError || details?.success === false) {
				const msg = details?.error ?? (result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "");
				text.setText(theme.fg("warning", msg.slice(0, 200)));
			} else if (options.isPartial) {
				text.setText(theme.fg("muted", "Loading skill..."));
			} else if (details?.success) {
				const what = details.filePath ? `${details.name} → ${details.filePath}` : `loaded skill '${details.name}'`;
				text.setText(theme.fg("toolOutput", what));
			} else {
				const output = result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
				text.setText(theme.fg("toolOutput", output.slice(0, 200)));
			}
			return text;
		},

		async execute(_toolCallId, args) {
			const result = executeSkillView(args, options);
			const text = JSON.stringify(result, null, 2);
			return {
				content: [{ type: "text", text }],
				details: {
					name: args.name,
					success: result.success === true,
					filePath: typeof result.file === "string" ? result.file : undefined,
					error: typeof result.error === "string" ? result.error : undefined,
				},
			};
		},
	};
}
