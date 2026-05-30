import { relative, sep } from "node:path";
import { PLATFORM_MAP } from "./constants.ts";
import type { SkillConditions, SkillFrontmatter } from "./types.ts";
import { PROMPT_INDEX_DESCRIPTION_MAX } from "./types.ts";

export function skillMatchesPlatform(frontmatter: SkillFrontmatter): boolean {
	const platforms = frontmatter.platforms;
	if (!platforms) {
		return true;
	}
	const list = Array.isArray(platforms) ? platforms : [platforms];
	if (list.length === 0) {
		return true;
	}
	const current = process.platform;
	for (const platform of list) {
		const normalized = String(platform).toLowerCase().trim();
		const mapped = PLATFORM_MAP[normalized] ?? normalized;
		if (current.startsWith(mapped)) {
			return true;
		}
	}
	return false;
}

export function extractSkillConditions(frontmatter: SkillFrontmatter): SkillConditions {
	const metadata = frontmatter.metadata;
	const metaObj = metadata && typeof metadata === "object" ? metadata : {};
	const hermes =
		metaObj.hermes && typeof metaObj.hermes === "object" ? (metaObj.hermes as Record<string, unknown>) : {};

	const toStringList = (value: unknown): string[] => {
		if (!value) return [];
		if (typeof value === "string") return [value];
		if (Array.isArray(value)) return value.map((v) => String(v));
		return [];
	};

	return {
		fallbackForToolsets: toStringList(hermes.fallback_for_toolsets),
		requiresToolsets: toStringList(hermes.requires_toolsets),
		fallbackForTools: toStringList(hermes.fallback_for_tools),
		requiresTools: toStringList(hermes.requires_tools),
	};
}

export function extractSkillDescription(frontmatter: SkillFrontmatter): string {
	const rawDesc = frontmatter.description;
	if (!rawDesc) {
		return "";
	}
	let desc = String(rawDesc).trim();
	if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
		desc = desc.slice(1, -1);
	}
	if (desc.length > PROMPT_INDEX_DESCRIPTION_MAX) {
		return `${desc.slice(0, PROMPT_INDEX_DESCRIPTION_MAX - 3)}...`;
	}
	return desc;
}

export function extractSkillTags(frontmatter: SkillFrontmatter): string[] | undefined {
	const metadata = frontmatter.metadata;
	if (!metadata || typeof metadata !== "object") return undefined;
	const hermes = metadata.hermes;
	if (!hermes || typeof hermes !== "object") return undefined;
	const tags = (hermes as { tags?: unknown }).tags;
	if (!tags) return undefined;
	if (Array.isArray(tags)) return tags.map((t) => String(t));
	return undefined;
}

export function extractRelatedSkills(frontmatter: SkillFrontmatter): string[] | undefined {
	const metadata = frontmatter.metadata;
	if (!metadata || typeof metadata !== "object") return undefined;
	const hermes = metadata.hermes;
	if (!hermes || typeof hermes !== "object") return undefined;
	const related = (hermes as { related_skills?: unknown }).related_skills;
	if (!related) return undefined;
	if (Array.isArray(related)) return related.map((r) => String(r));
	return undefined;
}

export function normalizePlatforms(frontmatter: SkillFrontmatter): string[] | undefined {
	const platforms = frontmatter.platforms;
	if (!platforms) return undefined;
	const list = Array.isArray(platforms) ? platforms : [platforms];
	const normalized = list.map((p) => String(p).trim()).filter((p) => p.length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

export function skillShouldShow(
	conditions: SkillConditions,
	availableTools: Set<string> | undefined,
	availableToolsets: Set<string> | undefined,
): boolean {
	if (!availableTools && !availableToolsets) {
		return true;
	}
	const at = availableTools ?? new Set<string>();
	const ats = availableToolsets ?? new Set<string>();

	for (const ts of conditions.fallbackForToolsets) {
		if (ats.has(ts)) return false;
	}
	for (const t of conditions.fallbackForTools) {
		if (at.has(t)) return false;
	}
	for (const ts of conditions.requiresToolsets) {
		if (!ats.has(ts)) return false;
	}
	for (const t of conditions.requiresTools) {
		if (!at.has(t)) return false;
	}
	return true;
}

export function computeSkillCategory(skillFilePath: string, skillsRoot: string): string {
	const rel = relative(skillsRoot, skillFilePath);
	const parts = rel.split(sep === "\\" ? /[/\\]/ : sep).filter(Boolean);
	if (parts.length >= 2) {
		if (parts.length > 2) {
			return parts.slice(0, -2).join("/");
		}
		return parts[0] ?? "general";
	}
	return "general";
}

export function buildSnapshotEntry(
	skillFile: string,
	skillsDir: string,
	frontmatter: SkillFrontmatter,
	description: string,
): {
	skill_name: string;
	category: string;
	frontmatter_name: string;
	description: string;
	platforms: string[];
	conditions: SkillConditions;
} {
	const rel = relative(skillsDir, skillFile);
	const parts = rel.split(sep === "\\" ? /[/\\]/ : sep).filter(Boolean);
	let skillName: string;
	let category: string;
	if (parts.length >= 2) {
		skillName = parts[parts.length - 2] ?? "unknown";
		category = parts.length > 2 ? parts.slice(0, -2).join("/") : (parts[0] ?? "general");
	} else {
		category = "general";
		skillName = parts.length > 0 ? parts[parts.length - 1]!.replace(/\.md$/i, "") : "unknown";
	}

	const platforms = normalizePlatforms(frontmatter) ?? [];

	return {
		skill_name: skillName,
		category,
		frontmatter_name: String(frontmatter.name ?? skillName),
		description,
		platforms,
		conditions: extractSkillConditions(frontmatter),
	};
}
