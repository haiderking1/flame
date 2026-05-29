import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { AssistantMessage, Context, Model, ToolCall } from "../src/types.ts";

interface CapturedRequest {
	url: string;
	body: any;
	headers: Record<string, string>;
}

function ndjsonStream(chunks: object[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "Content-Type": "application/x-ndjson" },
	});
}

function chunkedNdjsonStream(rawChunks: string[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const c of rawChunks) {
				controller.enqueue(encoder.encode(c));
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200 });
}

function ollamaModel(contextWindow: number, id = "llama3:8b"): Model<"openai-completions"> {
	return {
		id,
		name: "Llama (Local)",
		api: "openai-completions",
		provider: "ollama",
		baseUrl: "http://localhost:11434/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 4096,
	};
}

function simpleContext(text = "hi"): Context {
	return {
		systemPrompt: "you are helpful",
		messages: [{ role: "user", content: text, timestamp: Date.now() }],
	};
}

describe("Ollama native /api/chat transport", () => {
	let captured: CapturedRequest[] = [];

	beforeEach(() => {
		captured = [];
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(responder: () => Response | Promise<Response>) {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				const bodyStr = typeof init?.body === "string" ? init.body : "";
				const headers: Record<string, string> = {};
				const rawHeaders = init?.headers;
				if (rawHeaders) {
					if (rawHeaders instanceof Headers) {
						rawHeaders.forEach((v, k) => {
							headers[k.toLowerCase()] = v;
						});
					} else if (Array.isArray(rawHeaders)) {
						for (const [k, v] of rawHeaders) headers[k.toLowerCase()] = String(v);
					} else {
						for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
					}
				}
				captured.push({ url: String(url), body: bodyStr ? JSON.parse(bodyStr) : undefined, headers });
				return await responder();
			}),
		);
	}

	it("POSTs to /api/chat (not /v1/chat/completions) for Ollama models", async () => {
		stubFetch(() =>
			ndjsonStream([
				{ message: { role: "assistant", content: "Hello" }, done: false },
				{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
			]),
		);

		await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("http://localhost:11434/api/chat");
	});

	it("injects options.num_ctx matching model.contextWindow", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();

		expect(captured[0].body.options.num_ctx).toBe(8192);
		expect(captured[0].body.stream).toBe(true);
		expect(captured[0].body.model).toBe("llama3:8b");
	});

	it("clamps an absurd contextWindow to the safe upper bound", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(10_000_000), simpleContext()).result();

		expect(captured[0].body.options.num_ctx).toBe(1_048_576);
	});

	it("omits options.num_ctx when contextWindow is missing or zero", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(0), simpleContext()).result();

		expect(captured[0].body.options?.num_ctx).toBeUndefined();
	});

	it("converts system prompt and user message to Ollama native format", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(8192), {
			systemPrompt: "be terse",
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		}).result();

		expect(captured[0].body.messages).toEqual([
			{ role: "system", content: "be terse" },
			{ role: "user", content: "hello" },
		]);
	});

	it("streams text deltas and assembles the final assistant message", async () => {
		stubFetch(() =>
			ndjsonStream([
				{ message: { role: "assistant", content: "Hello" }, done: false },
				{ message: { role: "assistant", content: " world" }, done: false },
				{
					message: { role: "assistant", content: "" },
					done: true,
					done_reason: "stop",
					prompt_eval_count: 12,
					eval_count: 3,
				},
			]),
		);

		const final: AssistantMessage = await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();

		expect(final.stopReason).toBe("stop");
		expect(final.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(final.usage.input).toBe(12);
		expect(final.usage.output).toBe(3);
		expect(final.usage.totalTokens).toBe(15);
	});

	it("captures tool calls and sets stopReason=toolUse", async () => {
		stubFetch(() =>
			ndjsonStream([
				{
					message: {
						role: "assistant",
						content: "",
						tool_calls: [{ function: { name: "read_file", arguments: { path: "/etc/hosts" } } }],
					},
					done: false,
				},
				{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" },
			]),
		);

		const final = await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();

		expect(final.stopReason).toBe("toolUse");
		const toolCall = final.content.find((c): c is ToolCall => c.type === "toolCall");
		expect(toolCall).toBeDefined();
		expect(toolCall?.name).toBe("read_file");
		expect(toolCall?.arguments).toEqual({ path: "/etc/hosts" });
	});

	it("forwards tools in Ollama function-call format", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(8192), {
			systemPrompt: "x",
			messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
			tools: [
				{
					name: "read_file",
					description: "Read a file",
					parameters: { type: "object", properties: { path: { type: "string" } } } as any,
				},
			],
		}).result();

		expect(captured[0].body.tools).toEqual([
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file",
					parameters: { type: "object", properties: { path: { type: "string" } } },
				},
			},
		]);
	});

	it("handles NDJSON split across multiple network chunks", async () => {
		stubFetch(() =>
			chunkedNdjsonStream([
				'{"message":{"role":"assistant","content":"He',
				'llo"},"done":false}\n{"message":{"role":"assistant","content":"',
				' world"},"done":false}\n{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}\n',
			]),
		);

		const final = await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();
		expect(final.content).toEqual([{ type: "text", text: "Hello world" }]);
	});

	it("sends Authorization: Bearer for local Ollama (placeholder key)", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();

		expect(captured[0].headers.authorization).toBe("Bearer ollama");
	});

	it("uses an explicit options.apiKey as the Bearer token (remote Ollama / Ollama Cloud)", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		const remote: Model<"openai-completions"> = { ...ollamaModel(8192), baseUrl: "https://ollama.example.com/v1" };
		await streamOpenAICompletions(remote, simpleContext(), { apiKey: "sk-xyz" }).result();

		expect(captured[0].url).toBe("https://ollama.example.com/api/chat");
		expect(captured[0].headers.authorization).toBe("Bearer sk-xyz");
	});

	it("emits an error event when the server returns non-200", async () => {
		stubFetch(() => new Response("model not found", { status: 404 }));

		const result = await streamOpenAICompletions(ollamaModel(8192), simpleContext()).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("404");
	});

	it("passes user tool_result back as role:tool", async () => {
		stubFetch(() => ndjsonStream([{ message: { role: "assistant", content: "" }, done: true, done_reason: "stop" }]));

		await streamOpenAICompletions(ollamaModel(8192), {
			systemPrompt: "x",
			messages: [
				{ role: "user", content: "hi", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "/a" } }],
					api: "openai-completions",
					provider: "ollama",
					model: "llama3:8b",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: Date.now(),
				},
				{
					role: "toolResult",
					toolCallId: "call_1",
					toolName: "read_file",
					content: [{ type: "text", text: "file content here" }],
					isError: false,
					timestamp: Date.now(),
				},
			],
		}).result();

		const msgs = captured[0].body.messages as Array<{ role: string; content: string; tool_calls?: unknown }>;
		expect(msgs[2]).toEqual({
			role: "assistant",
			content: "",
			tool_calls: [{ function: { name: "read_file", arguments: { path: "/a" } } }],
		});
		expect(msgs[3]).toEqual({ role: "tool", content: "file content here" });
	});
});
