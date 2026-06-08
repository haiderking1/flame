export {
	createMemoryTool,
	createMemoryToolDefinition,
	type MemoryToolDetails,
	type MemoryToolInput,
} from "../memory/memory-tool.ts";
export {
	type AgentSwarmToolDetails,
	type AgentSwarmToolInput,
	type AgentSwarmToolOptions,
	createAgentSwarmTool,
	createAgentSwarmToolDefinition,
	type SwarmForkContext,
	type SwarmWorkerResult,
} from "./agent-swarm.ts";
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	type BrowserToolDetails,
	type BrowserToolInput,
	type BrowserToolOptions,
	createBrowserTool,
	createBrowserToolDefinition,
} from "./browser.ts";
export {
	type ClipboardToolDetails,
	type ClipboardToolInput,
	createClipboardTool,
	createClipboardToolDefinition,
} from "./clipboard.ts";
export {
	createDownloadTool,
	createDownloadToolDefinition,
	type DownloadToolDetails,
	type DownloadToolInput,
} from "./download.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export {
	createProcessTool,
	createProcessToolDefinition,
	type ProcessToolDetails,
	type ProcessToolInput,
	type ProcessToolOptions,
} from "./process.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWebSearchTool,
	createWebSearchToolDefinition,
	type WebSearchResult,
	type WebSearchToolDetails,
	type WebSearchToolInput,
	type WebSearchToolOptions,
} from "./web-search.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";

import type { AgentTool } from "@earendil-works/flame-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { MemoryStore } from "../memory/memory-store.ts";
import { createMemoryTool, createMemoryToolDefinition } from "../memory/memory-tool.ts";
import {
	createSkillManageTool,
	createSkillManageToolDefinition,
	type SkillManageToolOptions,
} from "../skills/skill-manage-tool.ts";
import { createSkillViewToolDefinition } from "../skills/skill-view-tool.ts";
import { createSkillsListToolDefinition } from "../skills/skills-list-tool.ts";
import { type AgentSwarmToolOptions, createAgentSwarmTool, createAgentSwarmToolDefinition } from "./agent-swarm.ts";
import { createAntigravityTool, createAntigravityToolDefinition } from "./antigravity.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { type BrowserToolOptions, createBrowserTool, createBrowserToolDefinition } from "./browser.ts";
import { createClaudeCodeTool, createClaudeCodeToolDefinition } from "./claude-code.ts";
import { createClipboardTool, createClipboardToolDefinition } from "./clipboard.ts";
import { createDownloadTool, createDownloadToolDefinition } from "./download.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createProcessTool, createProcessToolDefinition, type ProcessToolOptions } from "./process.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import { createTnrTool, createTnrToolDefinition } from "./tnr.ts";
import { createWebSearchTool, createWebSearchToolDefinition, type WebSearchToolOptions } from "./web-search.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
	| "agent_swarm"
	| "claude_code"
	| "antigravity"
	| "tnr"
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "web_search"
	| "download"
	| "browser"
	| "clipboard"
	| "process"
	| "memory"
	| "skills_list"
	| "skill_view"
	| "skill_manage";
export const allToolNames: Set<ToolName> = new Set([
	"agent_swarm",
	"claude_code",
	"antigravity",
	"tnr",
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"web_search",
	"download",
	"browser",
	"clipboard",
	"process",
	"memory",
	"skills_list",
	"skill_view",
	"skill_manage",
]);
export const DEFAULT_ACTIVE_TOOL_NAMES: ToolName[] = [
	"agent_swarm",
	"claude_code",
	"antigravity",
	"tnr",
	"read",
	"bash",
	"edit",
	"write",
	"web_search",
	"download",
	"browser",
	"clipboard",
	"process",
	"memory",
	"skills_list",
	"skill_view",
	"skill_manage",
];

export interface ToolsOptions {
	agent_swarm?: AgentSwarmToolOptions;
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	web_search?: WebSearchToolOptions;
	download?: unknown;
	browser?: BrowserToolOptions;
	clipboard?: unknown;
	process?: ProcessToolOptions;
	memory?: { store: MemoryStore };
	skills_list?: Record<string, never>;
	skill_view?: { sessionId?: string };
	skill_manage?: SkillManageToolOptions;
}

/**
 * Resolve agent_swarm options, falling back to a stub whose fork context throws.
 * The render path (tool-execution.ts) builds the definition only for its
 * renderers and never calls execute, so the stub is harmless there; the owning
 * AgentSession always supplies a real `getForkContext`.
 */
function swarmOptions(options?: ToolsOptions): AgentSwarmToolOptions {
	return (
		options?.agent_swarm ?? {
			getForkContext: () => {
				throw new Error("agent_swarm is unavailable: no parent agent fork context was provided");
			},
		}
	);
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	switch (toolName) {
		case "agent_swarm":
			return createAgentSwarmToolDefinition(swarmOptions(options));
		case "claude_code":
			return createClaudeCodeToolDefinition(cwd);
		case "antigravity":
			return createAntigravityToolDefinition(cwd);
		case "tnr":
			return createTnrToolDefinition(cwd);
		case "read":
			return createReadToolDefinition(cwd, options?.read);
		case "bash":
			return createBashToolDefinition(cwd, options?.bash);
		case "edit":
			return createEditToolDefinition(cwd, options?.edit);
		case "write":
			return createWriteToolDefinition(cwd, options?.write);
		case "grep":
			return createGrepToolDefinition(cwd, options?.grep);
		case "find":
			return createFindToolDefinition(cwd, options?.find);
		case "ls":
			return createLsToolDefinition(cwd, options?.ls);
		case "web_search":
			return createWebSearchToolDefinition(cwd, options?.web_search);
		case "download":
			return createDownloadToolDefinition(cwd, options?.download);
		case "browser":
			return createBrowserToolDefinition(cwd, options?.browser);
		case "clipboard":
			return createClipboardToolDefinition();
		case "process":
			return createProcessToolDefinition(cwd, options?.process);
		case "memory":
			return createMemoryToolDefinition(options?.memory?.store ?? new MemoryStore());
		case "skills_list":
			return createSkillsListToolDefinition();
		case "skill_view":
			return createSkillViewToolDefinition({ sessionId: options?.skill_view?.sessionId });
		case "skill_manage":
			return createSkillManageToolDefinition(options?.skill_manage ?? {});
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "agent_swarm":
			return createAgentSwarmTool(swarmOptions(options)) as Tool;
		case "claude_code":
			return createClaudeCodeTool(cwd);
		case "antigravity":
			return createAntigravityTool(cwd);
		case "tnr":
			return createTnrTool(cwd);
		case "read":
			return createReadTool(cwd, options?.read);
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "edit":
			return createEditTool(cwd, options?.edit);
		case "write":
			return createWriteTool(cwd, options?.write);
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "web_search":
			return createWebSearchTool(cwd, options?.web_search);
		case "download":
			return createDownloadTool(cwd, options?.download);
		case "browser":
			return createBrowserTool(cwd, options?.browser);
		case "clipboard":
			return createClipboardTool();
		case "process":
			return createProcessTool(cwd, options?.process);
		case "memory":
			return createMemoryTool(options?.memory?.store ?? new MemoryStore());
		case "skills_list":
			return createSkillsListToolDefinition() as Tool;
		case "skill_view":
			return createSkillViewToolDefinition({ sessionId: options?.skill_view?.sessionId }) as Tool;
		case "skill_manage":
			return createSkillManageTool(options?.skill_manage ?? {}) as Tool;
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, options?.edit),
		createWriteToolDefinition(cwd, options?.write),
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		agent_swarm: createAgentSwarmToolDefinition(swarmOptions(options)),
		claude_code: createClaudeCodeToolDefinition(cwd),
		antigravity: createAntigravityToolDefinition(cwd),
		tnr: createTnrToolDefinition(cwd),
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		web_search: createWebSearchToolDefinition(cwd, options?.web_search),
		download: createDownloadToolDefinition(cwd, options?.download),
		browser: createBrowserToolDefinition(cwd, options?.browser),
		clipboard: createClipboardToolDefinition(),
		process: createProcessToolDefinition(cwd, options?.process),
		memory: createMemoryToolDefinition(options?.memory?.store ?? new MemoryStore()),
		skills_list: createSkillsListToolDefinition(),
		skill_view: createSkillViewToolDefinition({ sessionId: options?.skill_view?.sessionId }),
		skill_manage: createSkillManageToolDefinition(options?.skill_manage ?? {}),
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		agent_swarm: createAgentSwarmTool(swarmOptions(options)) as Tool,
		claude_code: createClaudeCodeTool(cwd),
		antigravity: createAntigravityTool(cwd),
		tnr: createTnrTool(cwd),
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		web_search: createWebSearchTool(cwd, options?.web_search),
		download: createDownloadTool(cwd, options?.download),
		browser: createBrowserTool(cwd, options?.browser),
		clipboard: createClipboardTool(),
		process: createProcessTool(cwd, options?.process),
		memory: createMemoryTool(options?.memory?.store ?? new MemoryStore()),
		skills_list: createSkillsListToolDefinition() as Tool,
		skill_view: createSkillViewToolDefinition({ sessionId: options?.skill_view?.sessionId }) as Tool,
		skill_manage: createSkillManageTool(options?.skill_manage ?? {}) as Tool,
	};
}
