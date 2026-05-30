import { existsSync, mkdirSync } from "node:fs";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { discoverAllSkills } from "./discovery.ts";
import { getSkillsDir } from "./paths.ts";

const skillsListSchema = Type.Object({
	category: Type.Optional(
		Type.String({
			description: "Optional category filter (e.g., 'github')",
		}),
	),
});

export type SkillsListInput = Static<typeof skillsListSchema>;

export interface SkillsListToolDetails {
	count: number;
	success: boolean;
}

const SKILLS_LIST_DESCRIPTION =
	"List available skills (name + description). Use skill_view(name) to load full content.";

export interface SkillsListToolOptions {
	externalDirs?: string[];
	disabledNames?: Set<string>;
}

export function executeSkillsList(args: SkillsListInput, options: SkillsListToolOptions = {}): Record<string, unknown> {
	const skillsDir = getSkillsDir();
	if (!existsSync(skillsDir)) {
		try {
			mkdirSync(skillsDir, { recursive: true });
		} catch {}
	}

	const allSkills = discoverAllSkills({
		externalDirs: options.externalDirs,
		disabledNames: options.disabledNames,
	});

	const categoryFilter = args.category?.trim();
	let filtered = allSkills;
	if (categoryFilter) {
		filtered = allSkills.filter((s) => (s.category ?? "general") === categoryFilter);
	}

	const skills = filtered
		.map((s) => ({
			name: s.name,
			description: s.description,
			category: s.category ?? "general",
		}))
		.sort((a, b) => {
			const cat = a.category.localeCompare(b.category);
			if (cat !== 0) return cat;
			return a.name.localeCompare(b.name);
		});

	const categories = [...new Set(skills.map((s) => s.category))].sort();

	if (skills.length === 0) {
		return {
			success: true,
			skills: [],
			categories: [],
			count: 0,
			message: "No skills found. Skills live in ~/.flame/skills/<category>/<name>/SKILL.md",
			hint: "Use skill_view(name) to see full content, tags, and linked files",
		};
	}

	return {
		success: true,
		skills,
		categories,
		count: skills.length,
		hint: "Use skill_view(name) to see full content, tags, and linked files",
	};
}

export function createSkillsListToolDefinition(
	options: SkillsListToolOptions = {},
): ToolDefinition<typeof skillsListSchema, SkillsListToolDetails> {
	return {
		name: "skills_list",
		label: "skills_list",
		description: SKILLS_LIST_DESCRIPTION,
		promptSnippet: "List available skills (metadata only)",
		promptGuidelines: [],
		parameters: skillsListSchema,

		async execute(_toolCallId, args) {
			const result = executeSkillsList(args, options);
			const text = JSON.stringify(result, null, 2);
			return {
				content: [{ type: "text", text }],
				details: {
					count: typeof result.count === "number" ? result.count : 0,
					success: result.success === true,
				},
			};
		},
	};
}
