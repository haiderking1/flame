import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SourceInfo } from "../source-info.ts";

/** Max name length per spec */
export const MAX_SKILL_NAME_LENGTH = 64;

/** Max description length per spec */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

/** Prompt index description truncation (hermes parity) */
export const PROMPT_INDEX_DESCRIPTION_MAX = 60;

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
	platforms?: string[] | string;
	version?: string;
	author?: string;
	license?: string;
	prerequisites?: {
		env_vars?: string[];
		commands?: string[];
	};
	compatibility?: string;
	metadata?: {
		hermes?: {
			tags?: string[];
			related_skills?: string[];
			requires_tools?: string[];
			requires_toolsets?: string[];
			fallback_for_tools?: string[];
			fallback_for_toolsets?: string[];
			config?: unknown;
			[key: string]: unknown;
		};
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface SkillConditions {
	fallbackForToolsets: string[];
	requiresToolsets: string[];
	fallbackForTools: string[];
	requiresTools: string[];
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
	category?: string;
	platforms?: string[];
	tags?: string[];
	relatedSkills?: string[];
	conditions?: SkillConditions;
	descriptionFull?: string;
}

export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
	/** Skills root for category computation (defaults to dir) */
	skillsRoot?: string;
}

export interface LoadSkillsOptions {
	/** Working directory (used for explicit path resolution). */
	cwd: string;
	/** Agent config directory for legacy global skills. */
	agentDir: string;
	/** Explicit skill paths (files or directories) */
	skillPaths: string[];
	/** Include default skills directories. */
	includeDefaults: boolean;
}

export interface SkillSnapshotEntry {
	skill_name: string;
	category: string;
	frontmatter_name: string;
	description: string;
	platforms: string[];
	conditions: SkillConditions;
}

export interface SkillsPromptSnapshot {
	version: number;
	manifest: Record<string, [number, number]>;
	skills: SkillSnapshotEntry[];
	category_descriptions: Record<string, string>;
}
