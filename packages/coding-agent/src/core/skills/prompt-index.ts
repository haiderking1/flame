import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { atomicWrite } from "../memory/atomic-write.ts";
import { SKILLS_PROMPT_CACHE_MAX, SKILLS_SNAPSHOT_VERSION } from "./constants.ts";
import { iterSkillIndexFiles } from "./discovery.ts";
import {
	buildSnapshotEntry,
	extractSkillDescription,
	skillMatchesPlatform,
	skillShouldShow,
} from "./frontmatter.ts";
import { getSkillsDir, getSkillsPromptSnapshotPath } from "./paths.ts";
import { buildSkillsIndexFooter, buildSkillsIndexHeader } from "./prompt-strings.ts";
import type { SkillConditions, SkillFrontmatter, SkillSnapshotEntry, SkillsPromptSnapshot } from "./types.ts";

export interface BuildSkillsSystemPromptOptions {
	availableTools?: Set<string>;
	availableToolsets?: Set<string>;
	disabledNames?: Set<string>;
	externalDirs?: string[];
	platformHint?: string;
}

const skillsPromptCache = new Map<string, string>();

function buildSkillsManifest(skillsDir: string): Record<string, [number, number]> {
	const manifest: Record<string, [number, number]> = {};
	const resolvedRoot = resolve(skillsDir);
	for (const filename of ["SKILL.md", "DESCRIPTION.md"] as const) {
		for (const filePath of iterSkillIndexFiles(skillsDir, filename)) {
			try {
				const st = statSync(filePath);
				const rel = relative(resolvedRoot, filePath).split(sep).join("/");
				manifest[rel] = [st.mtimeMs * 1_000_000, st.size];
			} catch {}
		}
	}
	return manifest;
}

function loadSkillsSnapshot(skillsDir: string): SkillsPromptSnapshot | null {
	const snapshotPath = getSkillsPromptSnapshotPath();
	if (!existsSync(snapshotPath)) {
		return null;
	}
	try {
		const raw = readFileSync(snapshotPath, "utf-8");
		const snapshot = JSON.parse(raw) as SkillsPromptSnapshot;
		if (!snapshot || typeof snapshot !== "object") {
			return null;
		}
		if (snapshot.version !== SKILLS_SNAPSHOT_VERSION) {
			return null;
		}
		const manifest = buildSkillsManifest(skillsDir);
		const stored = snapshot.manifest ?? {};
		if (JSON.stringify(stored) !== JSON.stringify(manifest)) {
			return null;
		}
		return snapshot;
	} catch {
		return null;
	}
}

async function writeSkillsSnapshot(
	skillsDir: string,
	manifest: Record<string, [number, number]>,
	skillEntries: SkillSnapshotEntry[],
	categoryDescriptions: Record<string, string>,
): Promise<void> {
	const payload: SkillsPromptSnapshot = {
		version: SKILLS_SNAPSHOT_VERSION,
		manifest,
		skills: skillEntries,
		category_descriptions: categoryDescriptions,
	};
	try {
		await atomicWrite(getSkillsPromptSnapshotPath(), JSON.stringify(payload, null, 2));
	} catch {}
}

function parseSkillFile(skillFile: string): { compatible: boolean; frontmatter: SkillFrontmatter; description: string } {
	try {
		const raw = readFileSync(skillFile, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(raw);
		if (!skillMatchesPlatform(frontmatter)) {
			return { compatible: false, frontmatter, description: "" };
		}
		return { compatible: true, frontmatter, description: extractSkillDescription(frontmatter) };
	} catch {
		return { compatible: true, frontmatter: {}, description: "" };
	}
}

function readCategoryDescriptions(skillsDir: string): Record<string, string> {
	const descriptions: Record<string, string> = {};
	const resolvedRoot = resolve(skillsDir);
	for (const descFile of iterSkillIndexFiles(skillsDir, "DESCRIPTION.md")) {
		try {
			const content = readFileSync(descFile, "utf-8");
			const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content);
			const catDesc = frontmatter.description;
			if (!catDesc) continue;
			const rel = relative(resolvedRoot, descFile).split(sep).join("/");
			const parts = rel.split("/");
			const cat = parts.length > 1 ? parts.slice(0, -1).join("/") : "general";
			let desc = String(catDesc).trim();
			if (
				(desc.startsWith('"') && desc.endsWith('"')) ||
				(desc.startsWith("'") && desc.endsWith("'"))
			) {
				desc = desc.slice(1, -1);
			}
			descriptions[cat] = desc;
		} catch {}
	}
	return descriptions;
}

function formatIndexLines(
	skillsByCategory: Map<string, Array<[string, string]>>,
	categoryDescriptions: Record<string, string>,
): string {
	const indexLines: string[] = [];
	const categories = [...skillsByCategory.keys()].sort();
	for (const category of categories) {
		const catDesc = categoryDescriptions[category];
		if (catDesc) {
			indexLines.push(`  ${category}: ${catDesc}`);
		} else {
			indexLines.push(`  ${category}:`);
		}
		const seen = new Set<string>();
		const entries = [...(skillsByCategory.get(category) ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
		for (const [name, desc] of entries) {
			if (seen.has(name)) continue;
			seen.add(name);
			if (desc) {
				indexLines.push(`    - ${name}: ${desc}`);
			} else {
				indexLines.push(`    - ${name}`);
			}
		}
	}
	return indexLines.join("\n");
}

function cacheKey(options: BuildSkillsSystemPromptOptions, skillsDir: string, externalDirs: string[]): string {
	const tools = options.availableTools ? [...options.availableTools].sort().join(",") : "";
	const toolsets = options.availableToolsets ? [...options.availableToolsets].sort().join(",") : "";
	const disabled = options.disabledNames ? [...options.disabledNames].sort().join(",") : "";
	const ext = externalDirs.map((d) => resolve(d)).sort().join("|");
	return `${resolve(skillsDir)}|${ext}|${tools}|${toolsets}|${options.platformHint ?? ""}|${disabled}`;
}

function touchCache(key: string, value: string): void {
	if (skillsPromptCache.has(key)) {
		skillsPromptCache.delete(key);
	}
	skillsPromptCache.set(key, value);
	while (skillsPromptCache.size > SKILLS_PROMPT_CACHE_MAX) {
		const firstKey = skillsPromptCache.keys().next().value;
		if (firstKey !== undefined) {
			skillsPromptCache.delete(firstKey);
		} else {
			break;
		}
	}
}

export function clearSkillsSystemPromptCache(options?: { clearSnapshot?: boolean }): void {
	skillsPromptCache.clear();
	if (options?.clearSnapshot) {
		try {
			const snapshotPath = getSkillsPromptSnapshotPath();
			if (existsSync(snapshotPath)) {
				unlinkSync(snapshotPath);
			}
		} catch {}
	}
}

export async function buildSkillsSystemPrompt(options: BuildSkillsSystemPromptOptions = {}): Promise<string> {
	const skillsDir = getSkillsDir();
	const externalDirs = options.externalDirs ?? [];

	if (!existsSync(skillsDir) && externalDirs.every((d) => !existsSync(d))) {
		return "";
	}

	const key = cacheKey(options, skillsDir, externalDirs);
	const cached = skillsPromptCache.get(key);
	if (cached !== undefined) {
		touchCache(key, cached);
		return cached;
	}

	const disabled = options.disabledNames ?? new Set<string>();
	const skillsByCategory = new Map<string, Array<[string, string]>>();
	let categoryDescriptions: Record<string, string> = {};

	const snapshot = existsSync(skillsDir) ? loadSkillsSnapshot(skillsDir) : null;

	if (snapshot !== null) {
		for (const entry of snapshot.skills ?? []) {
			if (!entry || typeof entry !== "object") continue;
			const skillName = entry.skill_name ?? "";
			const category = entry.category ?? "general";
			const frontmatterName = entry.frontmatter_name ?? skillName;
			const platforms = entry.platforms ?? [];
			if (!skillMatchesPlatform({ platforms })) continue;
			if (disabled.has(frontmatterName) || disabled.has(skillName)) continue;
			const conditions: SkillConditions = entry.conditions ?? {
				fallbackForToolsets: [],
				requiresToolsets: [],
				fallbackForTools: [],
				requiresTools: [],
			};
			if (!skillShouldShow(conditions, options.availableTools, options.availableToolsets)) {
				continue;
			}
			skillsByCategory.set(category, [...(skillsByCategory.get(category) ?? []), [frontmatterName, entry.description ?? ""]]);
		}
		categoryDescriptions = { ...(snapshot.category_descriptions ?? {}) };
	} else if (existsSync(skillsDir)) {
		const skillEntries: SkillSnapshotEntry[] = [];
		for (const skillFile of iterSkillIndexFiles(skillsDir, "SKILL.md")) {
			const { compatible, frontmatter, description } = parseSkillFile(skillFile);
			const entry = buildSnapshotEntry(skillFile, skillsDir, frontmatter, description);
			skillEntries.push(entry);
			if (!compatible) continue;
			if (disabled.has(entry.frontmatter_name) || disabled.has(entry.skill_name)) continue;
			if (!skillShouldShow(entry.conditions, options.availableTools, options.availableToolsets)) {
				continue;
			}
			skillsByCategory.set(entry.category, [
				...(skillsByCategory.get(entry.category) ?? []),
				[entry.frontmatter_name, entry.description],
			]);
		}
		categoryDescriptions = readCategoryDescriptions(skillsDir);
		await writeSkillsSnapshot(skillsDir, buildSkillsManifest(skillsDir), skillEntries, categoryDescriptions);
	}

	const seenNames = new Set<string>();
	for (const catSkills of skillsByCategory.values()) {
		for (const [name] of catSkills) {
			seenNames.add(name);
		}
	}

	for (const extDir of externalDirs) {
		if (!existsSync(extDir)) continue;
		for (const skillFile of iterSkillIndexFiles(extDir, "SKILL.md")) {
			try {
				const { compatible, frontmatter, description } = parseSkillFile(skillFile);
				if (!compatible) continue;
				const entry = buildSnapshotEntry(skillFile, extDir, frontmatter, description);
				if (seenNames.has(entry.frontmatter_name)) continue;
				if (disabled.has(entry.frontmatter_name) || disabled.has(entry.skill_name)) continue;
				if (!skillShouldShow(entry.conditions, options.availableTools, options.availableToolsets)) {
					continue;
				}
				seenNames.add(entry.frontmatter_name);
				skillsByCategory.set(entry.category, [
					...(skillsByCategory.get(entry.category) ?? []),
					[entry.frontmatter_name, entry.description],
				]);
			} catch {}
		}
		const extDescriptions = readCategoryDescriptions(extDir);
		for (const [cat, desc] of Object.entries(extDescriptions)) {
			if (!(cat in categoryDescriptions)) {
				categoryDescriptions[cat] = desc;
			}
		}
	}

	let result = "";
	if (skillsByCategory.size > 0) {
		const indexLines = formatIndexLines(skillsByCategory, categoryDescriptions);
		result =
			buildSkillsIndexHeader() +
			"\n" +
			"<available_skills>\n" +
			indexLines +
			"\n</available_skills>\n" +
			buildSkillsIndexFooter();
	}

	touchCache(key, result);
	return result;
}

/** Synchronous wrapper for callers that cannot await. Uses cache/snapshot only. */
export function buildSkillsSystemPromptSync(options: BuildSkillsSystemPromptOptions = {}): string {
	const skillsDir = getSkillsDir();
	const externalDirs = options.externalDirs ?? [];

	if (!existsSync(skillsDir) && externalDirs.every((d) => !existsSync(d))) {
		return "";
	}

	const key = cacheKey(options, skillsDir, externalDirs);
	const cached = skillsPromptCache.get(key);
	if (cached !== undefined) {
		touchCache(key, cached);
		return cached;
	}

	const disabled = options.disabledNames ?? new Set<string>();
	const skillsByCategory = new Map<string, Array<[string, string]>>();
	let categoryDescriptions: Record<string, string> = {};

	const snapshot = existsSync(skillsDir) ? loadSkillsSnapshot(skillsDir) : null;

	if (snapshot !== null) {
		for (const entry of snapshot.skills ?? []) {
			if (!entry || typeof entry !== "object") continue;
			const skillName = entry.skill_name ?? "";
			const category = entry.category ?? "general";
			const frontmatterName = entry.frontmatter_name ?? skillName;
			const platforms = entry.platforms ?? [];
			if (!skillMatchesPlatform({ platforms })) continue;
			if (disabled.has(frontmatterName) || disabled.has(skillName)) continue;
			const conditions: SkillConditions = entry.conditions ?? {
				fallbackForToolsets: [],
				requiresToolsets: [],
				fallbackForTools: [],
				requiresTools: [],
			};
			if (!skillShouldShow(conditions, options.availableTools, options.availableToolsets)) {
				continue;
			}
			skillsByCategory.set(category, [...(skillsByCategory.get(category) ?? []), [frontmatterName, entry.description ?? ""]]);
		}
		categoryDescriptions = { ...(snapshot.category_descriptions ?? {}) };
	} else if (existsSync(skillsDir)) {
		for (const skillFile of iterSkillIndexFiles(skillsDir, "SKILL.md")) {
			const { compatible, frontmatter, description } = parseSkillFile(skillFile);
			const entry = buildSnapshotEntry(skillFile, skillsDir, frontmatter, description);
			if (!compatible) continue;
			if (disabled.has(entry.frontmatter_name) || disabled.has(entry.skill_name)) continue;
			if (!skillShouldShow(entry.conditions, options.availableTools, options.availableToolsets)) {
				continue;
			}
			skillsByCategory.set(entry.category, [
				...(skillsByCategory.get(entry.category) ?? []),
				[entry.frontmatter_name, entry.description],
			]);
		}
		categoryDescriptions = readCategoryDescriptions(skillsDir);
	}

	let result = "";
	if (skillsByCategory.size > 0) {
		const indexLines = formatIndexLines(skillsByCategory, categoryDescriptions);
		result =
			buildSkillsIndexHeader() +
			"\n" +
			"<available_skills>\n" +
			indexLines +
			"\n</available_skills>\n" +
			buildSkillsIndexFooter();
	}

	touchCache(key, result);
	return result;
}

export function getSkillsPromptCacheSize(): number {
	return skillsPromptCache.size;
}

export function resetSkillsPromptCacheForTests(): void {
	skillsPromptCache.clear();
}
