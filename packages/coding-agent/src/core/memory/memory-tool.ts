import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import type { MemoryStore } from "./memory-store.ts";

const memorySchema = Type.Object({
	action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")], {
		description: "What to do: add a new entry, replace an existing one, or remove one.",
	}),
	target: Type.Union([Type.Literal("memory"), Type.Literal("user")], {
		description: "Which store: 'memory' for personal notes (env facts, project conventions), 'user' for user profile (preferences, role, style).",
	}),
	content: Type.Optional(
		Type.String({ description: "Entry content. Required for 'add' and 'replace'." }),
	),
	old_text: Type.Optional(
		Type.String({
			description: "Short unique substring identifying the entry to replace or remove. Required for 'replace' and 'remove'.",
		}),
	),
});

export type MemoryToolInput = Static<typeof memorySchema>;

export interface MemoryToolDetails {
	action: MemoryToolInput["action"];
	target: MemoryToolInput["target"];
	success: boolean;
	entryCount?: number;
	usage?: string;
}

const TOOL_DESCRIPTION =
	"Save durable information to persistent memory that survives across sessions. " +
	"Memory is injected into future turns, so keep it compact and focused on facts that will still matter later.\n\n" +
	"WHEN TO SAVE (proactively — don't wait to be asked):\n" +
	"- User corrects you or says 'remember this' / 'don't do that again'\n" +
	"- User shares a preference, habit, or personal detail (name, role, timezone, coding style)\n" +
	"- You discover something about the environment (OS, installed tools, project structure)\n" +
	"- You learn a convention, API quirk, or workflow specific to this user's setup\n" +
	"- You identify a stable fact that will be useful again in future sessions\n\n" +
	"PRIORITY: User preferences and corrections > environment facts > procedural knowledge. " +
	"The most valuable memory prevents the user from having to repeat themselves.\n\n" +
	"Do NOT save task progress, session outcomes, completed-work logs, or temporary TODO state.\n\n" +
	"TWO TARGETS:\n" +
	"- 'user': who the user is — name, role, preferences, communication style, pet peeves\n" +
	"- 'memory': your notes — environment facts, project conventions, tool quirks, lessons learned\n\n" +
	"ACTIONS: add (new entry), replace (update existing — old_text identifies it), remove (delete — old_text identifies it).\n\n" +
	"SKIP: trivial/obvious info, things easily re-discovered, raw data dumps, and temporary task state.";

export function createMemoryToolDefinition(
	store: MemoryStore,
): ToolDefinition<typeof memorySchema, MemoryToolDetails> {
	return {
		name: "memory",
		label: "memory",
		description: TOOL_DESCRIPTION,
		promptSnippet: "Save or update persistent memory (env facts, user preferences, conventions)",
		promptGuidelines: [],
		parameters: memorySchema,

		async execute(_toolCallId, args) {
			const result = await dispatch(store, args);
			const text = JSON.stringify(result, null, 2);
			return {
				content: [{ type: "text", text }],
				details: {
					action: args.action,
					target: args.target,
					success: result.success,
					entryCount: result.success ? result.entry_count : undefined,
					usage: result.success ? result.usage : result.usage,
				},
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const action = args?.action ?? "memory";
			const target = args?.target ?? "";
			const preview =
				args?.action !== "remove" && args.content
					? args.content.length > 40
						? `${args.content.slice(0, 40)}...`
						: args.content
					: args?.old_text
						? args.old_text.length > 40
							? `${args.old_text.slice(0, 40)}...`
							: args.old_text
						: "";
			text.setText(
				`${theme.fg("toolTitle", theme.bold("memory"))} ${theme.fg("accent", `${action} ${target}`)}${
					preview ? ` ${theme.fg("muted", preview)}` : ""
				}`,
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as MemoryToolDetails | undefined;
			if (context.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("warning", msg.slice(0, 200)));
			} else if (options.isPartial) {
				text.setText(theme.fg("muted", "Updating memory..."));
			} else if (details?.success && details?.usage) {
				text.setText(theme.fg("toolOutput", `${details.action} ${details.target} — ${details.usage}`));
			} else {
				const output = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("toolOutput", output.slice(0, 200)));
			}
			return text;
		},
	};
}

export function createMemoryTool(store: MemoryStore): AgentTool<typeof memorySchema> {
	return wrapToolDefinition(createMemoryToolDefinition(store));
}

async function dispatch(store: MemoryStore, args: MemoryToolInput) {
	if (args.action === "add") {
		if (!args.content) return { success: false as const, error: "content is required for 'add' action." };
		return store.add(args.target, args.content);
	}
	if (args.action === "replace") {
		if (!args.old_text) return { success: false as const, error: "old_text is required for 'replace' action." };
		if (!args.content) return { success: false as const, error: "content is required for 'replace' action." };
		return store.replace(args.target, args.old_text, args.content);
	}
	if (args.action === "remove") {
		if (!args.old_text) return { success: false as const, error: "old_text is required for 'remove' action." };
		return store.remove(args.target, args.old_text);
	}
	return { success: false as const, error: `Unknown action '${String(args.action)}'.` };
}
