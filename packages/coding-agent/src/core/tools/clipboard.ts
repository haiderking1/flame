import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import { copyToClipboard, readFromClipboard } from "../../utils/clipboard.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, type TruncationResult, truncateHead } from "./truncate.ts";

const clipboardSchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("write")], {
		description: "read current clipboard text or write text to the clipboard",
	}),
	text: Type.Optional(Type.String({ description: "Text to write (required for write action)" })),
	append: Type.Optional(
		Type.Boolean({
			description: "Append to existing clipboard text instead of replacing it (write action only)",
		}),
	),
});

export type ClipboardToolInput = Static<typeof clipboardSchema>;

export interface ClipboardToolDetails {
	action: ClipboardToolInput["action"];
	bytes?: number;
	characters?: number;
	truncation?: TruncationResult;
	appended?: boolean;
}

export function createClipboardToolDefinition(): ToolDefinition<typeof clipboardSchema, ClipboardToolDetails> {
	return {
		name: "clipboard",
		label: "clipboard",
		description:
			"Read or write the system clipboard text. Use read to inspect what the user copied; use write to copy text for the user.",
		promptSnippet: "Read or write system clipboard text",
		promptGuidelines: [
			"Use clipboard read when the user refers to copied text or asks you to use what's on their clipboard.",
			"Use clipboard write to put generated text, commands, or snippets on the user's clipboard.",
		],
		parameters: clipboardSchema,

		async execute(_toolCallId, args) {
			if (args.action === "read") {
				const raw = await readFromClipboard();
				if (raw.length === 0) {
					return {
						content: [{ type: "text", text: "Clipboard is empty." }],
						details: { action: args.action, bytes: 0, characters: 0 },
					};
				}

				const truncated = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES });
				const suffix = truncated.truncated
					? `\n\n[Truncated: ${truncated.totalBytes} bytes total, showing first ${truncated.outputBytes} bytes]`
					: "";
				return {
					content: [{ type: "text", text: `${truncated.content}${suffix}` }],
					details: {
						action: args.action,
						bytes: truncated.totalBytes,
						characters: raw.length,
						truncation: truncated.truncated ? truncated : undefined,
					},
				};
			}

			if (args.action === "write") {
				if (args.text === undefined) {
					throw new Error("text is required for write action");
				}

				let payload = args.text;
				let appended = false;
				if (args.append) {
					try {
						const existing = await readFromClipboard();
						payload = existing.length > 0 ? `${existing}${args.text}` : args.text;
						appended = existing.length > 0;
					} catch {
						payload = args.text;
					}
				}

				await copyToClipboard(payload);
				const bytes = Buffer.byteLength(payload, "utf8");
				const actionText = appended ? "Appended to clipboard" : "Copied to clipboard";
				return {
					content: [{ type: "text", text: `${actionText} (${bytes} bytes, ${payload.length} characters).` }],
					details: {
						action: args.action,
						bytes,
						characters: payload.length,
						appended,
					},
				};
			}

			throw new Error(`Unsupported clipboard action: ${String(args.action)}`);
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const action = args?.action ?? "clipboard";
			const preview =
				args?.action === "write" && args.text
					? args.text.length > 40
						? `${args.text.slice(0, 40)}...`
						: args.text
					: "";
			text.setText(
				`${theme.fg("toolTitle", theme.bold("clipboard"))} ${theme.fg("accent", action)}${preview ? ` ${theme.fg("muted", preview)}` : ""}`,
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as ClipboardToolDetails | undefined;
			if (context.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("warning", msg.slice(0, 120)));
			} else if (options.isPartial) {
				text.setText(theme.fg("muted", "Accessing clipboard..."));
			} else if (details?.action === "read") {
				const output = result.content[0]?.type === "text" ? result.content[0].text : "";
				const lines = output.split("\n");
				const maxLines = options.expanded ? lines.length : 5;
				const preview = lines.slice(0, maxLines).join("\n");
				text.setText(theme.fg("toolOutput", preview || "Clipboard is empty."));
			} else {
				const output = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("toolOutput", output));
			}
			return text;
		},
	};
}

export function createClipboardTool(): AgentTool<typeof clipboardSchema> {
	return wrapToolDefinition(createClipboardToolDefinition());
}
