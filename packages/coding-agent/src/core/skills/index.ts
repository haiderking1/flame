export {
	EXCLUDED_SKILL_DIRS,
	INJECTION_PATTERNS,
	INLINE_SHELL_MAX_OUTPUT,
	PLATFORM_MAP,
	SKILLS_PROMPT_CACHE_MAX,
	SKILLS_SNAPSHOT_VERSION,
} from "./constants.ts";
export {
	discoverAllSkills,
	getCategoryFromSkillPath,
	isExcludedSkillPath,
	iterSkillIndexFiles,
	loadSkills,
	loadSkillsFromDir,
} from "./discovery.ts";
export { formatSkillsForPrompt } from "./format.ts";
export {
	buildSnapshotEntry,
	computeSkillCategory,
	extractRelatedSkills,
	extractSkillConditions,
	extractSkillDescription,
	extractSkillTags,
	normalizePlatforms,
	skillMatchesPlatform,
	skillShouldShow,
} from "./frontmatter.ts";
export {
	formatScanReport,
	type SkillGuardFinding,
	type SkillScanResult,
	scanSkill,
	scanSkillFile,
	securityScanSkillDir,
	shouldAllowInstall,
} from "./guard.ts";
export {
	getSkillGuardThreatPatternCount,
	HERMES_THREAT_PATTERN_COUNT,
	SKILL_GUARD_THREAT_PATTERNS,
} from "./guard-patterns.ts";
export { hasTraversalComponent, isPathWithinDir, validateWithinDir } from "./path-security.ts";
export {
	getLegacyAgentSkillsDir,
	getSkillBundlesDir,
	getSkillsDir,
	getSkillsPromptSnapshotPath,
} from "./paths.ts";
export {
	defaultInlineShellEnabled,
	defaultPreprocessingConfig,
	expandInlineShell,
	preprocessSkillContent,
	runInlineShell,
	type SkillsPreprocessingConfig,
	substituteTemplateVars,
} from "./preprocessing.ts";
export {
	type BuildSkillsSystemPromptOptions,
	buildSkillsSystemPrompt,
	buildSkillsSystemPromptSync,
	clearSkillsSystemPromptCache,
	getSkillsPromptCacheSize,
	resetSkillsPromptCacheForTests,
} from "./prompt-index.ts";
export {
	buildSkillsIndexFooter,
	buildSkillsIndexHeader,
	SKILLS_GUIDANCE,
} from "./prompt-strings.ts";
export {
	executeSkillManage,
	findSkillDirectory,
	type SkillManageActionOptions,
	type SkillManageResult,
} from "./skill-manage-actions.ts";
export {
	createSkillManageTool,
	createSkillManageToolDefinition,
	type SkillManageInput,
	type SkillManageToolDetails,
	type SkillManageToolOptions,
} from "./skill-manage-tool.ts";
export {
	createSkillViewToolDefinition,
	executeSkillView,
	type SkillViewInput,
	type SkillViewToolDetails,
	type SkillViewToolOptions,
} from "./skill-view-tool.ts";
export {
	createSkillsListToolDefinition,
	executeSkillsList,
	type SkillsListInput,
	type SkillsListToolDetails,
	type SkillsListToolOptions,
} from "./skills-list-tool.ts";
export {
	type BuildSkillInvocationOptions,
	buildSkillInvocationMessage,
	expandSkillSlashCommand,
	skillNameToSlashSlug,
} from "./slash-commands.ts";
export type {
	LoadSkillsFromDirOptions,
	LoadSkillsOptions,
	LoadSkillsResult,
	Skill,
	SkillConditions,
	SkillFrontmatter,
	SkillSnapshotEntry,
	SkillsPromptSnapshot,
} from "./types.ts";
export {
	MAX_SKILL_DESCRIPTION_LENGTH,
	MAX_SKILL_NAME_LENGTH,
	PROMPT_INDEX_DESCRIPTION_MAX,
} from "./types.ts";
