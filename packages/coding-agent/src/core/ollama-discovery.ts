import type { Model } from "@earendil-works/flame-ai";

export const OLLAMA_LOCAL_BASE_URL = "http://localhost:11434/v1";

const OLLAMA_DISCOVERY_TIMEOUT_MS = 3000;

function ollamaApiRoot(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

interface OllamaV1Model {
	id: string;
	object?: string;
	created?: number;
	owned_by?: string;
}

interface OllamaV1ModelsResponse {
	object: string;
	data: OllamaV1Model[];
}

interface OllamaShowDetails {
	parent_model?: string;
	format?: string;
	family?: string;
	families?: string[];
	parameter_size?: string;
	quantization_level?: string;
	context_length?: number;
	embedding_length?: number;
}

interface OllamaShowResponse {
	model_info?: Record<string, unknown>;
	details?: OllamaShowDetails;
	capabilities?: string[];
	modified_at?: string;
	remote_model?: string;
	remote_host?: string;
	parameters?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Resolve a model's effective context window from Ollama's /api/show response.
 *
 * Priority:
 *   1. Modelfile-level num_ctx override (parsed from the `parameters` text).
 *      This is what the user explicitly asked Ollama to use, so it always wins.
 *   2. Architectural max from GGUF model_info (e.g. `llama.context_length`).
 *      What the model was trained for; safe upper bound the model can handle.
 *   3. Conservative fallback for malformed responses.
 *
 * Runtime num_ctx (what Ollama auto-loaded with based on VRAM) is intentionally
 * not consulted here. Once discovered, we inject `context_length` per request
 * in the OpenAI-compat transport, so the server allocates KV cache to exactly
 * this value — no /api/ps polling, no silent truncation.
 */
function extractContextLength(show: OllamaShowResponse): number {
	if (typeof show.parameters === "string") {
		const match = show.parameters.match(/^\s*num_ctx\s+(\d+)\s*$/m);
		if (match) {
			const value = Number.parseInt(match[1], 10);
			if (Number.isFinite(value) && value > 0) return value;
		}
	}
	if (show.details?.context_length) {
		return show.details.context_length;
	}
	if (show.model_info) {
		for (const key of Object.keys(show.model_info)) {
			if (key.endsWith(".context_length")) {
				const value = show.model_info[key];
				if (typeof value === "number" && Number.isFinite(value) && value > 0) {
					return value;
				}
			}
		}
	}
	return 32768;
}

function formatModelName(modelId: string, details: OllamaShowDetails | undefined): string {
	if (details?.family) {
		const family = details.family;
		const capitalized = family.charAt(0).toUpperCase() + family.slice(1);
		return `${capitalized} (Local)`;
	}
	const name = modelId.split(":")[0];
	const replaced = name.replace(/[-_]/g, " ");
	const capitalized = replaced
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
	return `${capitalized} (Local)`;
}

function isCloudProxy(model: OllamaV1Model, show: OllamaShowResponse | undefined): boolean {
	if (show?.remote_host?.includes("ollama.com")) {
		return true;
	}
	if (model.id.endsWith(":cloud") || model.id.endsWith("-cloud")) {
		return true;
	}
	return false;
}

function isEmbeddingOnly(show: OllamaShowResponse | undefined): boolean {
	if (!show?.capabilities || show.capabilities.length === 0) {
		return false;
	}
	const caps = show.capabilities;
	const hasEmbedding = caps.includes("embedding");
	const hasCompletion = caps.includes("completion");
	const hasTools = caps.includes("tools");
	return hasEmbedding && !hasCompletion && !hasTools;
}

export async function discoverOllamaLocalModels(): Promise<Model<"openai-completions">[]> {
	const apiRoot = ollamaApiRoot(OLLAMA_LOCAL_BASE_URL);
	let listResponse: Response;
	try {
		listResponse = await fetchWithTimeout(`${apiRoot}/v1/models`, undefined, OLLAMA_DISCOVERY_TIMEOUT_MS);
	} catch {
		return [];
	}

	if (!listResponse.ok) {
		return [];
	}

	let listBody: OllamaV1ModelsResponse;
	try {
		listBody = (await listResponse.json()) as OllamaV1ModelsResponse;
	} catch {
		return [];
	}

	if (!Array.isArray(listBody.data)) {
		return [];
	}

	const showResults = await Promise.allSettled(
		listBody.data.map(async (model) => {
			try {
				const res = await fetchWithTimeout(
					`${apiRoot}/api/show`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ model: model.id }),
					},
					OLLAMA_DISCOVERY_TIMEOUT_MS,
				);
				if (!res.ok) return undefined;
				return (await res.json()) as OllamaShowResponse;
			} catch {
				return undefined;
			}
		}),
	);

	const models: Model<"openai-completions">[] = [];

	for (let i = 0; i < listBody.data.length; i++) {
		const model = listBody.data[i];
		const showResult = showResults[i];
		const show: OllamaShowResponse | undefined = showResult.status === "fulfilled" ? showResult.value : undefined;

		if (isCloudProxy(model, show)) {
			continue;
		}

		if (isEmbeddingOnly(show)) {
			continue;
		}

		const contextWindow = extractContextLength(show ?? ({} as OllamaShowResponse));
		const maxTokens = Math.max(Math.floor(contextWindow / 4), 4096);
		const capabilities = show?.capabilities ?? [];
		const reasoning = capabilities.includes("thinking");
		const input: ("text" | "image")[] = capabilities.includes("vision") ? ["text", "image"] : ["text"];

		models.push({
			id: model.id,
			name: formatModelName(model.id, show?.details),
			api: "openai-completions",
			provider: "ollama",
			baseUrl: OLLAMA_LOCAL_BASE_URL,
			reasoning,
			input,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow,
			maxTokens,
		});
	}

	return models;
}

export async function isOllamaLocalRunning(): Promise<boolean> {
	try {
		const res = await fetchWithTimeout(`${ollamaApiRoot(OLLAMA_LOCAL_BASE_URL)}/v1/models`, undefined, 1000);
		return res.ok;
	} catch {
		return false;
	}
}
