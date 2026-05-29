import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverOllamaLocalModels } from "../src/core/ollama-discovery.ts";

interface FetchCall {
	url: string;
	init?: RequestInit;
}

function setupFetchMock(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
	const calls: FetchCall[] = [];
	const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
		const call = { url: String(url), init };
		calls.push(call);
		return await handler(call);
	});
	vi.stubGlobal("fetch", fetchMock);
	return calls;
}

const SHOW_LLAMA: unknown = {
	model_info: { "llama.context_length": 131072 },
	details: { family: "llama" },
	capabilities: ["completion", "tools"],
};

const SHOW_GEMMA: unknown = {
	model_info: { "gemma.context_length": 131072 },
	details: { family: "gemma" },
	capabilities: ["completion"],
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("discoverOllamaLocalModels", () => {
	it("uses the architectural max from /api/show when no Modelfile override is set", async () => {
		setupFetchMock(async ({ url }) => {
			if (url.endsWith("/v1/models")) {
				return Response.json({ object: "list", data: [{ id: "llama3:8b" }] });
			}
			if (url.endsWith("/api/show")) {
				return Response.json(SHOW_LLAMA);
			}
			return new Response("", { status: 404 });
		});

		const models = await discoverOllamaLocalModels();
		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("llama3:8b");
		expect(models[0].contextWindow).toBe(131072);
	});

	it("prefers an explicit Modelfile num_ctx over the architectural max", async () => {
		setupFetchMock(async ({ url }) => {
			if (url.endsWith("/v1/models")) {
				return Response.json({ object: "list", data: [{ id: "llama3:8b" }] });
			}
			if (url.endsWith("/api/show")) {
				return Response.json({
					...(SHOW_LLAMA as object),
					parameters: "num_ctx 8192\ntemperature 0.7",
				});
			}
			return new Response("", { status: 404 });
		});

		const models = await discoverOllamaLocalModels();
		expect(models).toHaveLength(1);
		expect(models[0].contextWindow).toBe(8192);
	});

	it("ignores a malformed num_ctx entry in parameters and falls back to model_info", async () => {
		setupFetchMock(async ({ url }) => {
			if (url.endsWith("/v1/models")) {
				return Response.json({ object: "list", data: [{ id: "gemma3:12b" }] });
			}
			if (url.endsWith("/api/show")) {
				return Response.json({
					...(SHOW_GEMMA as object),
					parameters: "num_ctx not_a_number",
				});
			}
			return new Response("", { status: 404 });
		});

		const models = await discoverOllamaLocalModels();
		expect(models).toHaveLength(1);
		expect(models[0].contextWindow).toBe(131072);
	});

	it("returns no models when /v1/models is unreachable", async () => {
		setupFetchMock(async () => {
			throw new Error("ECONNREFUSED");
		});

		const models = await discoverOllamaLocalModels();
		expect(models).toHaveLength(0);
	});

	it("skips embedding-only models", async () => {
		setupFetchMock(async ({ url }) => {
			if (url.endsWith("/v1/models")) {
				return Response.json({ object: "list", data: [{ id: "nomic-embed:latest" }] });
			}
			if (url.endsWith("/api/show")) {
				return Response.json({
					model_info: { "nomic.context_length": 8192 },
					details: { family: "nomic" },
					capabilities: ["embedding"],
				});
			}
			return new Response("", { status: 404 });
		});

		const models = await discoverOllamaLocalModels();
		expect(models).toHaveLength(0);
	});

	it("does not query /api/ps anymore (discovery is /api/show only)", async () => {
		const calls = setupFetchMock(async ({ url }) => {
			if (url.endsWith("/v1/models")) {
				return Response.json({ object: "list", data: [{ id: "llama3:8b" }] });
			}
			if (url.endsWith("/api/show")) {
				return Response.json(SHOW_LLAMA);
			}
			return new Response("", { status: 404 });
		});

		await discoverOllamaLocalModels();
		const psCalls = calls.filter((c) => c.url.endsWith("/api/ps"));
		expect(psCalls).toHaveLength(0);
	});
});
