import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { canonicalizePath, resolvePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "../source-info.ts";
import { EXCLUDED_SKILL_DIRS } from "./constants.ts";
import {
	computeSkillCategory,
	extractRelatedSkills,
	extractSkillConditions,
	extractSkillTags,
	normalizePlatforms,
	skillMatchesPlatform,
} from "./frontmatter.ts";
import { getLegacyAgentSkillsDir, getSkillsDir } from "./paths.ts";
import type {
	LoadSkillsFromDirOptions,
	LoadSkillsOptions,
	LoadSkillsResult,
	Skill,
	SkillFrontmatter,
} from "./types.ts";
import { MAX_SKILL_DESCRIPTION_LENGTH, MAX_SKILL_NAME_LENGTH } from "./types.ts";

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

type IgnoreMatcher = ReturnType<typeof ignore>;

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

export function isExcludedSkillPath(filePath: string): boolean {
	const parts = filePath.split(/[/\\]/);
	return parts.some((part) => EXCLUDED_SKILL_DIRS.has(part));
}

/**
 * Walk skillsDir yielding sorted paths matching filename.
 * Excludes dependency, VCS, virtualenv, and cache directories.
 */
export function* iterSkillIndexFiles(skillsDir: string, filename: string): Generator<string> {
	if (!existsSync(skillsDir)) {
		return;
	}

	const matches: string[] = [];

	function walk(dir: string): void {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory() && EXCLUDED_SKILL_DIRS.has(entry.name)) {
				continue;
			}

			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}

			if (entry.name === filename) {
				matches.push(fullPath);
			}
		}
	}

	walk(skillsDir);

	const resolvedRoot = resolve(skillsDir);
	matches.sort((a, b) => {
		const relA = relative(resolvedRoot, a);
		const relB = relative(resolvedRoot, b);
		return relA.localeCompare(relB);
	});

	for (const path of matches) {
		yield path;
	}
}

function validateName(name: string): string[] {
	const errors: string[] = [];

	if (name.length > MAX_SKILL_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_SKILL_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
	}

	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push(`name must not start or end with a hyphen`);
	}

	if (name.includes("--")) {
		errors.push(`name must not contain consecutive hyphens`);
	}

	return errors;
}

function validateDescription(description: string | undefined): string[] {
	const errors: string[] = [];

	if (!description || description.trim() === "") {
		errors.push("description is required");
	} else if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "user",
				baseDir,
			});
		case "path":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				baseDir,
			});
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	const skillsRoot = options.skillsRoot ?? dir;
	return loadSkillsFromDirInternal(dir, source, true, undefined, undefined, skillsRoot);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
	skillsRoot?: string,
): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) {
		return { skills, diagnostics };
	}

	const root = rootDir ?? dir;
	const categoryRoot = skillsRoot ?? dir;
	const ig = ignoreMatcher ?? ignore();
	addIgnoreRules(ig, dir, root);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name !== "SKILL.md") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			if (!isFile || ig.ignores(relPath)) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source, categoryRoot);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
			return { skills, diagnostics };
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			if (entry.name === "node_modules" || EXCLUDED_SKILL_DIRS.has(entry.name)) {
				continue;
			}

			const fullPath = join(dir, entry.name);

			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			const ignorePath = isDirectory ? `${relPath}/` : relPath;
			if (ig.ignores(ignorePath)) {
				continue;
			}

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root, categoryRoot);
				skills.push(...subResult.skills);
				diagnostics.push(...subResult.diagnostics);
				continue;
			}

			if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source, categoryRoot);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
		}
	} catch {}

	return { skills, diagnostics };
}

function loadSkillFromFile(
	filePath: string,
	source: string,
	skillsRoot: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);

		const descErrors = validateDescription(frontmatter.description);
		for (const error of descErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		const name = frontmatter.name || parentDirName;

		const nameErrors = validateName(name);
		for (const error of nameErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { skill: null, diagnostics };
		}

		if (!skillMatchesPlatform(frontmatter)) {
			return { skill: null, diagnostics };
		}

		const descriptionFull = frontmatter.description;
		const category = computeSkillCategory(filePath, skillsRoot);
		const conditions = extractSkillConditions(frontmatter);
		const tags = extractSkillTags(frontmatter);
		const relatedSkills = extractRelatedSkills(frontmatter);
		const platforms = normalizePlatforms(frontmatter);

		return {
			skill: {
				name,
				description: descriptionFull,
				descriptionFull,
				filePath,
				baseDir: skillDir,
				sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
				disableModelInvocation: frontmatter["disable-model-invocation"] === true,
				category,
				platforms,
				tags,
				relatedSkills,
				conditions,
			},
			diagnostics,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to parse skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const { agentDir, skillPaths, includeDefaults } = options;

	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(agentDir);

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addSkills(result: LoadSkillsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			const realPath = canonicalizePath(skill.filePath);

			if (realPathSet.has(realPath)) {
				continue;
			}

			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	if (includeDefaults) {
		const flameSkillsDir = getSkillsDir();
		addSkills(loadSkillsFromDirInternal(flameSkillsDir, "user", true, undefined, undefined, flameSkillsDir));
		const legacyDir = getLegacyAgentSkillsDir(resolvedAgentDir);
		addSkills(loadSkillsFromDirInternal(legacyDir, "user", true, undefined, undefined, legacyDir));
	}

	const flameSkillsDir = getSkillsDir();
	const legacySkillsDir = getLegacyAgentSkillsDir(resolvedAgentDir);

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSource = (resolvedPath: string): "user" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(resolvedPath, flameSkillsDir)) return "user";
			if (isUnderPath(resolvedPath, legacySkillsDir)) return "user";
		}
		return "path";
	};

	for (const rawPath of skillPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, source, true, undefined, undefined, resolvedPath));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const parentDir = dirname(resolvedPath);
				const result = loadSkillFromFile(resolvedPath, source, parentDir);
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}

/** Collect all skills from primary and optional external directories. */
export function discoverAllSkills(options?: {
	externalDirs?: string[];
	disabledNames?: Set<string>;
	skipPlatformFilter?: boolean;
}): Skill[] {
	const externalDirs = options?.externalDirs ?? [];
	const disabled = options?.disabledNames ?? new Set<string>();
	const dirs: string[] = [];
	const skillsDir = getSkillsDir();
	if (existsSync(skillsDir)) {
		dirs.push(skillsDir);
	}
	for (const ext of externalDirs) {
		if (existsSync(ext)) {
			dirs.push(ext);
		}
	}

	const seen = new Set<string>();
	const skills: Skill[] = [];

	for (const dir of dirs) {
		for (const skillMd of iterSkillIndexFiles(dir, "SKILL.md")) {
			if (isExcludedSkillPath(skillMd)) {
				continue;
			}
			const result = loadSkillFromFile(skillMd, "user", dir);
			if (!result.skill) {
				continue;
			}
			const skill = result.skill;
			if (disabled.has(skill.name)) {
				continue;
			}
			if (seen.has(skill.name)) {
				continue;
			}
			seen.add(skill.name);
			skills.push(skill);
		}
	}

	return skills;
}

export function getCategoryFromSkillPath(skillMdPath: string, skillsRoot: string): string {
	return computeSkillCategory(skillMdPath, skillsRoot);
}
