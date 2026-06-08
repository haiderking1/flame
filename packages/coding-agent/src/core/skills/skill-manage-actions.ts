import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { atomicWrite } from "../memory/atomic-write.ts";
import { withFileLock } from "../memory/file-lock.ts";
import { fuzzyFindText, normalizeForFuzzyMatch } from "../tools/edit-diff.ts";
import {
	ALLOWED_SKILL_SUBDIRS,
	MAX_SKILL_CONTENT_CHARS,
	MAX_SKILL_FILE_BYTES,
	SKILL_MANAGE_NAME_RE,
} from "./constants.ts";
import { isExcludedSkillPath, iterSkillIndexFiles } from "./discovery.ts";
import { securityScanSkillDir } from "./guard.ts";
import { hasTraversalComponent, validateWithinDir } from "./path-security.ts";
import { getSkillsDir } from "./paths.ts";
import { clearSkillsSystemPromptCache } from "./prompt-index.ts";
import type { SkillFrontmatter } from "./types.ts";
import { MAX_SKILL_DESCRIPTION_LENGTH, MAX_SKILL_NAME_LENGTH } from "./types.ts";

export interface SkillManageResult {
	success: boolean;
	message?: string;
	error?: string;
	path?: string;
	skill_md?: string;
	category?: string;
	hint?: string;
	file_preview?: string;
	available_files?: string[] | null;
}

export interface SkillManageActionOptions {
	guardAgentCreated?: boolean;
}

function validateName(name: string): string | null {
	if (!name) return "Skill name is required.";
	if (name.length > MAX_SKILL_NAME_LENGTH) {
		return `Skill name exceeds ${MAX_SKILL_NAME_LENGTH} characters.`;
	}
	if (!SKILL_MANAGE_NAME_RE.test(name)) {
		return (
			`Invalid skill name '${name}'. Use lowercase letters, numbers, ` +
			"hyphens, dots, and underscores. Must start with a letter or digit."
		);
	}
	return null;
}

function validateCategory(category: string | undefined): string | null {
	if (category === undefined || category === null) return null;
	const trimmed = category.trim();
	if (!trimmed) return null;
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		return (
			`Invalid category '${category}'. Use lowercase letters, numbers, ` +
			"hyphens, dots, and underscores. Categories must be a single directory name."
		);
	}
	if (trimmed.length > MAX_SKILL_NAME_LENGTH) {
		return `Category exceeds ${MAX_SKILL_NAME_LENGTH} characters.`;
	}
	if (!SKILL_MANAGE_NAME_RE.test(trimmed)) {
		return (
			`Invalid category '${category}'. Use lowercase letters, numbers, ` +
			"hyphens, dots, and underscores. Categories must be a single directory name."
		);
	}
	return null;
}

function validateFrontmatter(content: string): string | null {
	if (!content.trim()) return "Content cannot be empty.";
	if (!content.startsWith("---")) {
		return "SKILL.md must start with YAML frontmatter (---). See existing skills for format.";
	}
	const endMatch = /\n---\s*\n/.exec(content.slice(3));
	if (!endMatch) {
		return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line.";
	}
	const yamlContent = content.slice(3, endMatch.index + 3);
	let parsed: unknown;
	try {
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(`---\n${yamlContent}\n---\n`);
		parsed = frontmatter;
	} catch (e) {
		return `YAML frontmatter parse error: ${e instanceof Error ? e.message : String(e)}`;
	}
	if (!parsed || typeof parsed !== "object") {
		return "Frontmatter must be a YAML mapping (key: value pairs).";
	}
	const fm = parsed as SkillFrontmatter;
	if (!fm.name) return "Frontmatter must include 'name' field.";
	if (!fm.description) return "Frontmatter must include 'description' field.";
	if (String(fm.description).length > MAX_SKILL_DESCRIPTION_LENGTH) {
		return `Description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters.`;
	}
	const bodyStart = endMatch.index + endMatch[0].length + 3;
	const body = content.slice(bodyStart).trim();
	if (!body) {
		return "SKILL.md must have content after the frontmatter (instructions, procedures, etc.).";
	}
	return null;
}

function validateContentSize(content: string, label = "SKILL.md"): string | null {
	if (content.length > MAX_SKILL_CONTENT_CHARS) {
		return (
			`${label} content is ${content.length.toLocaleString()} characters ` +
			`(limit: ${MAX_SKILL_CONTENT_CHARS.toLocaleString()}). ` +
			"Consider splitting into a smaller SKILL.md with supporting files in references/ or templates/."
		);
	}
	return null;
}

export function findSkillDirectory(name: string): string | null {
	const skillsDir = getSkillsDir();
	if (!existsSync(skillsDir)) {
		return null;
	}
	for (const skillMd of iterSkillIndexFiles(skillsDir, "SKILL.md")) {
		if (isExcludedSkillPath(skillMd)) continue;
		if (dirname(skillMd).split(/[/\\]/).pop() === name) {
			return dirname(skillMd);
		}
	}
	return null;
}

function resolveSkillDir(name: string, category?: string): string {
	const skillsDir = getSkillsDir();
	if (category?.trim()) {
		return join(skillsDir, category.trim(), name);
	}
	return join(skillsDir, name);
}

function skillNotFoundError(name: string, suffix = ""): string {
	let base = `Skill '${name}' not found. Use skills_list() to see available skills.`;
	if (suffix) base += suffix;
	return base;
}

function validateFilePath(filePath: string): string | null {
	if (!filePath) return "file_path is required.";
	if (hasTraversalComponent(filePath)) {
		return "Path traversal ('..') is not allowed.";
	}
	const parts = filePath.split(/[/\\]/);
	if (!parts.length || !ALLOWED_SKILL_SUBDIRS.has(parts[0])) {
		const allowed = [...ALLOWED_SKILL_SUBDIRS].sort().join(", ");
		return `File must be under one of: ${allowed}. Got: '${filePath}'`;
	}
	if (parts.length < 2) {
		return `Provide a file path, not just a directory. Example: '${parts[0]}/myfile.md'`;
	}
	return null;
}

function resolveSkillTarget(skillDir: string, filePath: string): { target: string | null; error: string | null } {
	const target = join(skillDir, filePath);
	const err = validateWithinDir(target, skillDir);
	if (err) return { target: null, error: err };
	return { target, error: null };
}

function fuzzyFindAndReplace(
	content: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
): { newContent: string; matchCount: number; error?: string; file_preview?: string } {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOld = normalizeForFuzzyMatch(oldString);
	const occurrenceCount = fuzzyContent.split(fuzzyOld).length - 1;

	if (occurrenceCount === 0) {
		const preview = content.slice(0, 500) + (content.length > 500 ? "..." : "");
		return {
			newContent: content,
			matchCount: 0,
			error: `Could not find the text to replace. The old_string must match (fuzzy matching is applied).`,
			file_preview: preview,
		};
	}

	if (!replaceAll && occurrenceCount > 1) {
		return {
			newContent: content,
			matchCount: occurrenceCount,
			error: `Found ${occurrenceCount} occurrences of the text. The text must be unique unless replace_all=true.`,
		};
	}

	const match = fuzzyFindText(content, oldString);
	if (!match.found) {
		return {
			newContent: content,
			matchCount: 0,
			error: "Could not find the text to replace.",
		};
	}

	let base = match.contentForReplacement;
	let matchCount = 0;

	if (replaceAll) {
		const parts = base.split(fuzzyOld);
		matchCount = parts.length - 1;
		base = parts.join(newString);
	} else {
		base = base.slice(0, match.index) + newString + base.slice(match.index + match.matchLength);
		matchCount = 1;
	}

	if (base === match.contentForReplacement && newString === oldString) {
		return {
			newContent: content,
			matchCount: 0,
			error: "No changes made. The replacement produced identical content.",
		};
	}

	return { newContent: base, matchCount };
}

async function writeTextAtomic(
	filePath: string,
	content: string,
	guardEnabled: boolean,
	skillDir: string,
): Promise<string | null> {
	await atomicWrite(filePath, content);
	return securityScanSkillDir(skillDir, guardEnabled);
}

function pruneEmptyCategoryDir(skillDir: string): void {
	const skillsRoot = resolve(getSkillsDir());
	const parent = dirname(skillDir);
	if (parent === skillsRoot || !existsSync(parent)) return;
	try {
		const entries = readdirSync(parent);
		if (entries.length === 0) {
			rmSync(parent, { recursive: true, force: true });
		}
	} catch {}
}

function invalidateCache(): void {
	clearSkillsSystemPromptCache({ clearSnapshot: true });
}

export async function executeSkillManage(
	args: {
		action: string;
		name: string;
		content?: string;
		category?: string;
		file_path?: string;
		file_content?: string;
		old_string?: string;
		new_string?: string;
		replace_all?: boolean;
		absorbed_into?: string;
	},
	options: SkillManageActionOptions = {},
): Promise<SkillManageResult> {
	const guardEnabled = options.guardAgentCreated === true;
	const { action, name } = args;

	switch (action) {
		case "create":
			return createSkill(name, args.content ?? "", args.category, guardEnabled);
		case "edit":
			return editSkill(name, args.content ?? "", guardEnabled);
		case "patch":
			return patchSkill(
				name,
				args.old_string ?? "",
				args.new_string ?? "",
				args.file_path,
				args.replace_all === true,
				guardEnabled,
			);
		case "delete":
			return deleteSkill(name, args.absorbed_into, guardEnabled);
		case "write_file":
			return writeSkillFile(name, args.file_path ?? "", args.file_content ?? "", guardEnabled);
		case "remove_file":
			return removeSkillFile(name, args.file_path ?? "");
		default:
			return {
				success: false,
				error: `Unknown action '${action}'. Use: create, edit, patch, delete, write_file, remove_file`,
			};
	}
}

async function createSkill(
	name: string,
	content: string,
	category: string | undefined,
	guardEnabled: boolean,
): Promise<SkillManageResult> {
	const nameErr = validateName(name);
	if (nameErr) return { success: false, error: nameErr };
	const catErr = validateCategory(category);
	if (catErr) return { success: false, error: catErr };
	if (!content) {
		return {
			success: false,
			error: "content is required for 'create'. Provide the full SKILL.md text (frontmatter + body).",
		};
	}
	const fmErr = validateFrontmatter(content);
	if (fmErr) return { success: false, error: fmErr };
	const sizeErr = validateContentSize(content);
	if (sizeErr) return { success: false, error: sizeErr };

	const existing = findSkillDirectory(name);
	if (existing) {
		return { success: false, error: `A skill named '${name}' already exists at ${existing}.` };
	}

	const skillDir = resolveSkillDir(name, category);
	const skillMd = join(skillDir, "SKILL.md");
	const lockPath = skillMd;

	return withFileLock(lockPath, async () => {
		mkdirSync(skillDir, { recursive: true });
		const scanErr = await writeTextAtomic(skillMd, content, guardEnabled, skillDir);
		if (scanErr) {
			rmSync(skillDir, { recursive: true, force: true });
			return { success: false, error: scanErr };
		}
		invalidateCache();
		const relPath = relative(getSkillsDir(), skillDir).split(/[/\\]/).join("/");
		const result: SkillManageResult = {
			success: true,
			message: `Skill '${name}' created.`,
			path: relPath,
			skill_md: skillMd,
			hint:
				`To add reference files, templates, or scripts, use ` +
				`skill_manage(action='write_file', name='${name}', file_path='references/example.md', file_content='...')`,
		};
		if (category?.trim()) {
			result.category = category.trim();
		}
		return result;
	});
}

async function editSkill(name: string, content: string, guardEnabled: boolean): Promise<SkillManageResult> {
	if (!content) {
		return { success: false, error: "content is required for 'edit'. Provide the full updated SKILL.md text." };
	}
	const fmErr = validateFrontmatter(content);
	if (fmErr) return { success: false, error: fmErr };
	const sizeErr = validateContentSize(content);
	if (sizeErr) return { success: false, error: sizeErr };

	const skillDir = findSkillDirectory(name);
	if (!skillDir) {
		return { success: false, error: skillNotFoundError(name) };
	}

	const skillMd = join(skillDir, "SKILL.md");
	return withFileLock(skillMd, async () => {
		const originalContent = existsSync(skillMd) ? readFileSync(skillMd, "utf-8") : null;
		const scanErr = await writeTextAtomic(skillMd, content, guardEnabled, skillDir);
		if (scanErr) {
			if (originalContent !== null) {
				await atomicWrite(skillMd, originalContent);
			}
			return { success: false, error: scanErr };
		}
		invalidateCache();
		return {
			success: true,
			message: `Skill '${name}' updated.`,
			path: skillDir,
		};
	});
}

async function patchSkill(
	name: string,
	oldString: string,
	newString: string,
	filePath: string | undefined,
	replaceAll: boolean,
	guardEnabled: boolean,
): Promise<SkillManageResult> {
	if (!oldString) return { success: false, error: "old_string is required for 'patch'." };
	if (newString === undefined || newString === null) {
		return {
			success: false,
			error: "new_string is required for 'patch'. Use an empty string to delete matched text.",
		};
	}

	const skillDir = findSkillDirectory(name);
	if (!skillDir) {
		return { success: false, error: skillNotFoundError(name) };
	}

	let target: string;
	if (filePath) {
		const pathErr = validateFilePath(filePath);
		if (pathErr) return { success: false, error: pathErr };
		const resolved = resolveSkillTarget(skillDir, filePath);
		if (resolved.error) return { success: false, error: resolved.error };
		target = resolved.target!;
	} else {
		target = join(skillDir, "SKILL.md");
	}

	if (!existsSync(target)) {
		return { success: false, error: `File not found: ${relative(skillDir, target)}` };
	}

	return withFileLock(target, async () => {
		const content = readFileSync(target, "utf-8");
		const { newContent, matchCount, error, file_preview } = fuzzyFindAndReplace(
			content,
			oldString,
			newString,
			replaceAll,
		);
		if (error) {
			const result: SkillManageResult = { success: false, error };
			if (file_preview) result.file_preview = file_preview;
			return result;
		}

		const targetLabel = filePath ?? "SKILL.md";
		const sizeErr = validateContentSize(newContent, targetLabel);
		if (sizeErr) return { success: false, error: sizeErr };

		if (!filePath) {
			const fmErr = validateFrontmatter(newContent);
			if (fmErr) {
				return { success: false, error: `Patch would break SKILL.md structure: ${fmErr}` };
			}
		}

		const scanErr = await writeTextAtomic(target, newContent, guardEnabled, skillDir);
		if (scanErr) {
			return { success: false, error: scanErr };
		}
		invalidateCache();
		const plural = matchCount > 1 ? "s" : "";
		return {
			success: true,
			message: `Patched ${targetLabel} in skill '${name}' (${matchCount} replacement${plural}).`,
		};
	});
}

async function deleteSkill(
	name: string,
	absorbedInto: string | undefined,
	_guardEnabled: boolean,
): Promise<SkillManageResult> {
	const skillDir = findSkillDirectory(name);
	if (!skillDir) {
		return { success: false, error: skillNotFoundError(name) };
	}

	if (absorbedInto?.trim()) {
		const targetName = absorbedInto.trim();
		if (targetName === name) {
			return { success: false, error: `absorbed_into='${targetName}' cannot equal the skill being deleted.` };
		}
		const target = findSkillDirectory(targetName);
		if (!target) {
			return {
				success: false,
				error:
					`absorbed_into='${targetName}' does not exist. ` +
					"Create or patch the umbrella skill first, then retry the delete.",
			};
		}
	}

	const lockPath = join(skillDir, "SKILL.md");
	return withFileLock(lockPath, async () => {
		rmSync(skillDir, { recursive: true, force: true });
		pruneEmptyCategoryDir(skillDir);
		invalidateCache();
		let message = `Skill '${name}' deleted.`;
		if (absorbedInto?.trim()) {
			message += ` Content absorbed into '${absorbedInto.trim()}'.`;
		}
		return { success: true, message };
	});
}

async function writeSkillFile(
	name: string,
	filePath: string,
	fileContent: string,
	guardEnabled: boolean,
): Promise<SkillManageResult> {
	const pathErr = validateFilePath(filePath);
	if (pathErr) return { success: false, error: pathErr };
	if (fileContent === undefined || fileContent === null) {
		return { success: false, error: "file_content is required for 'write_file'." };
	}

	const contentBytes = Buffer.byteLength(fileContent, "utf-8");
	if (contentBytes > MAX_SKILL_FILE_BYTES) {
		return {
			success: false,
			error:
				`File content is ${contentBytes.toLocaleString()} bytes ` +
				`(limit: ${MAX_SKILL_FILE_BYTES.toLocaleString()} bytes / 1 MiB). ` +
				"Consider splitting into smaller files.",
		};
	}
	const sizeErr = validateContentSize(fileContent, filePath);
	if (sizeErr) return { success: false, error: sizeErr };

	const skillDir = findSkillDirectory(name);
	if (!skillDir) {
		return { success: false, error: skillNotFoundError(name, " Create it first with action='create'.") };
	}

	const resolved = resolveSkillTarget(skillDir, filePath);
	if (resolved.error) return { success: false, error: resolved.error };
	const target = resolved.target!;

	return withFileLock(target, async () => {
		mkdirSync(dirname(target), { recursive: true });
		const originalContent = existsSync(target) ? readFileSync(target, "utf-8") : null;
		const scanErr = await writeTextAtomic(target, fileContent, guardEnabled, skillDir);
		if (scanErr) {
			if (originalContent !== null) {
				await atomicWrite(target, originalContent);
			} else if (existsSync(target)) {
				unlinkSync(target);
			}
			return { success: false, error: scanErr };
		}
		invalidateCache();
		return {
			success: true,
			message: `File '${filePath}' written to skill '${name}'.`,
			path: target,
		};
	});
}

async function removeSkillFile(name: string, filePath: string): Promise<SkillManageResult> {
	const pathErr = validateFilePath(filePath);
	if (pathErr) return { success: false, error: pathErr };
	if (!filePath) return { success: false, error: "file_path is required for 'remove_file'." };

	const skillDir = findSkillDirectory(name);
	if (!skillDir) {
		return { success: false, error: skillNotFoundError(name) };
	}

	const resolved = resolveSkillTarget(skillDir, filePath);
	if (resolved.error) return { success: false, error: resolved.error };
	const target = resolved.target!;

	if (!existsSync(target)) {
		const available: string[] = [];
		const collectFiles = (dir: string, base: string): void => {
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
						available.push(relative(base, full).split(/[/\\]/).join("/"));
					} else if (st.isDirectory()) {
						collectFiles(full, base);
					}
				} catch {}
			}
		};
		for (const subdir of ALLOWED_SKILL_SUBDIRS) {
			const d = join(skillDir, subdir);
			if (existsSync(d)) {
				collectFiles(d, skillDir);
			}
		}
		return {
			success: false,
			error: `File '${filePath}' not found in skill '${name}'.`,
			available_files: available.length > 0 ? available : null,
		};
	}

	return withFileLock(target, async () => {
		unlinkSync(target);
		const parent = dirname(target);
		if (parent !== skillDir && existsSync(parent)) {
			try {
				if (readdirSync(parent).length === 0) {
					rmSync(parent, { recursive: true, force: true });
				}
			} catch {}
		}
		invalidateCache();
		return {
			success: true,
			message: `File '${filePath}' removed from skill '${name}'.`,
		};
	});
}
