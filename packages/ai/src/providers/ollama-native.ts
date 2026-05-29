import { getEnvApiKey } from "../env-api-keys.ts";
import type {
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import type { OpenAICompletionsOptions } from "./openai-completions.ts";

// See packages/ai/src/providers/openai-completions.ts for the public rationale:
// Ollama's `/v1/chat/completions` shim has no per-request way to set context
// size — the closed PR #8672 (top-level `context_length`) and the unmerged
// PR #11249 (`options` field) confirm this. The only working API surface is
// the native `/api/chat`, which accepts `options.num_ctx`. This transport
// bypasses the OpenAI SDK for Ollama so proactive compaction matches the
// num_ctx Ollama actually allocates, eliminating silent truncation.

const MAX_OLLAMA_NUM_CTX = 1_048_576;

interface OllamaToolCall {
	function: {
		name: string;
		arguments: Record<string, unknown>;
	};
}

interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	thinking?: string;
	tool_calls?: OllamaToolCall[];
	images?: string[];
}

interface OllamaChatRequest {
	model: string;
	messages: OllamaMessage[];
	tools?: unknown[];
	stream: true;
	options?: Record<string, unknown>;
	keep_alive?: string | number;
}

interface OllamaChatChunk {
	model?: string;
	message?: {
		role?: string;
		content?: string;
		thinking?: string;
		tool_calls?: OllamaToolCall[];
	};
	done: boolean;
	done_reason?: string;
	prompt_eval_count?: number;
	eval_count?: number;
}

function ollamaApiRoot(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function clampNumCtx(contextWindow: number | undefined): number | undefined {
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return undefined;
	}
	return Math.min(MAX_OLLAMA_NUM_CTX, Math.floor(contextWindow));
}

function generateToolCallId(): string {
	return `call_${Math.random().toString(36).slice(2, 12)}`;
}

function partsToText(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === "string") return content;
	let text = "";
	for (const part of content) {
		if (part.type === "text") text += part.text;
	}
	return text;
}

function partsToImages(content: string | (TextContent | ImageContent)[]): string[] | undefined {
	if (typeof content === "string") return undefined;
	const images: string[] = [];
	for (const part of content) {
		if (part.type === "image") images.push(part.data);
	}
	return images.length > 0 ? images : undefined;
}

function convertMessages(systemPrompt: string | undefined, messages: Message[]): OllamaMessage[] {
	const result: OllamaMessage[] = [];
	if (systemPrompt) {
		result.push({ role: "system", content: systemPrompt });
	}
	for (const msg of messages) {
		if (msg.role === "user") {
			const text = partsToText(msg.content);
			const images = partsToImages(msg.content);
			const entry: OllamaMessage = { role: "user", content: text };
			if (images) entry.images = images;
			result.push(entry);
		} else if (msg.role === "assistant") {
			let text = "";
			let thinking = "";
			const toolCalls: OllamaToolCall[] = [];
			for (const block of msg.content) {
				if (block.type === "text") {
					text += block.text;
				} else if (block.type === "thinking") {
					thinking += block.thinking;
				} else if (block.type === "toolCall") {
					toolCalls.push({ function: { name: block.name, arguments: block.arguments } });
				}
			}
			const entry: OllamaMessage = { role: "assistant", content: text };
			if (thinking) entry.thinking = thinking;
			if (toolCalls.length > 0) entry.tool_calls = toolCalls;
			result.push(entry);
		} else if (msg.role === "toolResult") {
			let text = "";
			for (const part of msg.content) {
				if (part.type === "text") text += part.text;
			}
			result.push({ role: "tool", content: text });
		}
	}
	return result;
}

function convertTools(tools: Tool[]): unknown[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

export function streamOllamaNative(
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const baseUrl = model.baseUrl;
			if (!baseUrl) {
				throw new Error("Ollama model is missing a baseUrl");
			}
			const url = `${ollamaApiRoot(baseUrl)}/api/chat`;

			const ollamaOptions: Record<string, unknown> = {};
			const numCtx = clampNumCtx(model.contextWindow);
			if (numCtx !== undefined) ollamaOptions.num_ctx = numCtx;
			if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
			if (options?.maxTokens && options.maxTokens > 0) ollamaOptions.num_predict = options.maxTokens;

			const body: OllamaChatRequest = {
				model: model.id,
				messages: convertMessages(context.systemPrompt, context.messages),
				stream: true,
			};
			if (context.tools && context.tools.length > 0) {
				body.tools = convertTools(context.tools);
			}
			if (Object.keys(ollamaOptions).length > 0) {
				body.options = ollamaOptions;
			}

			let payload: unknown = body;
			const overridden = await options?.onPayload?.(payload, model);
			if (overridden !== undefined) payload = overridden;

			// Resolve auth the same way openai-completions.ts does: explicit
			// option > env var > "ollama" placeholder for local. Remote Ollama,
			// Ollama Cloud, and reverse-proxied instances all require a Bearer
			// token; local Ollama ignores the value but accepts the header.
			const isLocalOllama = baseUrl.includes("localhost:11434") || baseUrl.includes("127.0.0.1:11434");
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || (isLocalOllama ? "ollama" : undefined);

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
			for (const [k, v] of Object.entries(options?.headers ?? {})) {
				headers[k] = v;
			}

			const init: RequestInit = {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			};
			if (options?.signal) init.signal = options.signal;

			const response = await fetch(url, init);
			await options?.onResponse?.(
				{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
				model,
			);

			if (!response.ok || !response.body) {
				const errText = response.body ? await response.text() : "";
				throw new Error(`Ollama /api/chat returned ${response.status}: ${errText.slice(0, 500)}`);
			}

			stream.push({ type: "start", partial: output });

			let textBlock: TextContent | null = null;
			let textIndex = -1;
			let thinkingBlock: ThinkingContent | null = null;
			let thinkingIndex = -1;
			let sawToolCall = false;
			let finalDoneReason: string | undefined;

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					let lineEnd: number;
					// biome-ignore lint/suspicious/noAssignInExpressions: NDJSON parse loop
					while ((lineEnd = buffer.indexOf("\n")) !== -1) {
						const line = buffer.slice(0, lineEnd).trim();
						buffer = buffer.slice(lineEnd + 1);
						if (!line) continue;

						let chunk: OllamaChatChunk;
						try {
							chunk = JSON.parse(line) as OllamaChatChunk;
						} catch {
							continue;
						}

						const msg = chunk.message;
						if (msg?.thinking) {
							if (!thinkingBlock) {
								thinkingBlock = { type: "thinking", thinking: "" };
								thinkingIndex = output.content.length;
								output.content.push(thinkingBlock);
								stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
							}
							thinkingBlock.thinking += msg.thinking;
							stream.push({
								type: "thinking_delta",
								contentIndex: thinkingIndex,
								delta: msg.thinking,
								partial: output,
							});
						}
						if (msg?.content && msg.content.length > 0) {
							if (thinkingBlock) {
								stream.push({
									type: "thinking_end",
									contentIndex: thinkingIndex,
									content: thinkingBlock.thinking,
									partial: output,
								});
								thinkingBlock = null;
							}
							if (!textBlock) {
								textBlock = { type: "text", text: "" };
								textIndex = output.content.length;
								output.content.push(textBlock);
								stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
							}
							textBlock.text += msg.content;
							stream.push({ type: "text_delta", contentIndex: textIndex, delta: msg.content, partial: output });
						}
						if (msg?.tool_calls && msg.tool_calls.length > 0) {
							if (textBlock) {
								stream.push({
									type: "text_end",
									contentIndex: textIndex,
									content: textBlock.text,
									partial: output,
								});
								textBlock = null;
							}
							if (thinkingBlock) {
								stream.push({
									type: "thinking_end",
									contentIndex: thinkingIndex,
									content: thinkingBlock.thinking,
									partial: output,
								});
								thinkingBlock = null;
							}
							for (const tc of msg.tool_calls) {
								const toolCall: ToolCall = {
									type: "toolCall",
									id: generateToolCallId(),
									name: tc.function?.name ?? "",
									arguments: tc.function?.arguments ?? {},
								};
								const idx = output.content.length;
								output.content.push(toolCall);
								stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
								stream.push({
									type: "toolcall_delta",
									contentIndex: idx,
									delta: JSON.stringify(toolCall.arguments),
									partial: output,
								});
								stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
								sawToolCall = true;
							}
						}

						if (chunk.done) {
							finalDoneReason = chunk.done_reason;
							const input = chunk.prompt_eval_count ?? 0;
							const outputCount = chunk.eval_count ?? 0;
							output.usage = {
								input,
								output: outputCount,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: input + outputCount,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							};
						}
					}
				}
			} finally {
				reader.releaseLock();
			}

			if (textBlock) {
				stream.push({ type: "text_end", contentIndex: textIndex, content: textBlock.text, partial: output });
			}
			if (thinkingBlock) {
				stream.push({
					type: "thinking_end",
					contentIndex: thinkingIndex,
					content: thinkingBlock.thinking,
					partial: output,
				});
			}

			let stopReason: Extract<StopReason, "stop" | "length" | "toolUse"> = "stop";
			if (sawToolCall) {
				stopReason = "toolUse";
			} else if (finalDoneReason === "length") {
				stopReason = "length";
			}
			output.stopReason = stopReason;
			stream.push({ type: "done", reason: stopReason, message: output });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			const isAbort = err instanceof Error && (err.name === "AbortError" || /abort/i.test(message));
			output.stopReason = isAbort ? "aborted" : "error";
			output.errorMessage = message;
			stream.push({ type: "error", reason: isAbort ? "aborted" : "error", error: output });
		}
	})();

	return stream;
}
