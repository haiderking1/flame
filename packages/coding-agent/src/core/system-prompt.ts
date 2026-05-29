/**
 * System prompt construction and project context loading
 */

import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";
import { DEFAULT_ACTIVE_TOOL_NAMES } from "./tools/index.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/** SOUL.md content — replaces the default identity paragraph when set. */
	identity?: string;
	/** Hermes-style skills index (stable tier). When set, replaces formatSkillsForPrompt. */
	skillsIndexBlock?: string;
	/** SKILLS_GUIDANCE prose when skill_manage is active (stable tier). */
	skillsGuidanceBlock?: string;
	/** Volatile blocks (MEMORY/USER snapshots) injected after skills, before date/cwd. */
	volatileBlocks?: string[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
		identity,
		skillsIndexBlock,
		skillsGuidanceBlock,
		volatileBlocks,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const date = `${year}-${month}-${day}`;

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Skills: hermes index when skill tools are loaded, else legacy XML catalog via read tool.
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (skillsGuidanceBlock?.trim()) {
			prompt += `\n\n${skillsGuidanceBlock.trim()}`;
		}
		if (skillsIndexBlock?.trim()) {
			prompt += `\n\n${skillsIndexBlock.trim()}`;
		} else if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n<project_context>\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
			}
			prompt += "</project_context>\n";
		}

		// Volatile blocks (memory + user profile snapshots) — injected before date/cwd.
		if (volatileBlocks && volatileBlocks.length > 0) {
			const nonEmpty = volatileBlocks.filter((b) => b && b.trim().length > 0);
			if (nonEmpty.length > 0) {
				prompt += `\n\n${nonEmpty.join("\n\n")}`;
			}
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || DEFAULT_ACTIVE_TOOL_NAMES;
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");
	const hasDownload = tools.includes("download");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		addGuideline("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	if (hasDownload && hasBash) {
		addGuideline(
			"After download completes, run post-download shell commands with bash using the returned savePath; do not embed shell commands in download",
		);
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	const identityParagraph =
		identity && identity.trim().length > 0
			? identity.trim()
			: "You are Flame, an expert coding assistant. You help users by reading files, executing commands, editing code, and writing new files.";

	let prompt = `${identityParagraph}

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Flame documentation (read only when the user asks about Flame itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading Flame docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), Flame packages (docs/packages.md)
- When working on Flame topics, read the docs and examples, and follow .md cross-references before implementing
- Always read Flame .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Skills index + guidance in stable tier (after Flame documentation, before project_context).
	if (skillsGuidanceBlock?.trim()) {
		prompt += `\n\n${skillsGuidanceBlock.trim()}`;
	}
	if (skillsIndexBlock?.trim()) {
		prompt += `\n\n${skillsIndexBlock.trim()}`;
	} else if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Volatile blocks (memory + user profile snapshots) — injected before date/cwd.
	if (volatileBlocks && volatileBlocks.length > 0) {
		const nonEmpty = volatileBlocks.filter((b) => b && b.trim().length > 0);
		if (nonEmpty.length > 0) {
			prompt += `\n\n${nonEmpty.join("\n\n")}`;
		}
	}

	// Add date and working directory last
	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
