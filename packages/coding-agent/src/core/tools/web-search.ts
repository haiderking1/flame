import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	numResults: Type.Optional(Type.Number({ description: "Number of results to return (default: 5, max: 10)" })),
	type: Type.Optional(
		Type.Union([Type.Literal("neural"), Type.Literal("keyword")], {
			description: "Search type: 'neural' for semantic/AI search (default) or 'keyword' for exact match",
		}),
	),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export interface WebSearchResult {
	title: string;
	url: string;
	publishedDate?: string;
	snippet?: string;
}

export interface WebSearchToolDetails {
	query: string;
	numResults: number;
	results: WebSearchResult[];
}

export interface WebSearchToolOptions {
	apiKey?: string;
}

const EXA_SEARCH_URL = "https://api.exa.ai/search";

interface McpToolCallResponse {
	jsonrpc?: string;
	id?: string | number | null;
	result?: {
		content?: Array<{
			type?: string;
			text?: string;
		}>;
		isError?: boolean;
	};
	error?:
		| {
				code?: number;
				message?: string;
				data?: unknown;
		  }
		| string;
}

function parseMcpSearchResults(text: string): WebSearchResult[] {
	const blocks = text.split(/\n\s*---\s*\n/);
	const results: WebSearchResult[] = [];

	for (const block of blocks) {
		const lines = block.split("\n");
		let title = "";
		let url = "";
		let publishedDate = "";
		const snippetLines: string[] = [];
		let inHighlights = false;

		for (const line of lines) {
			if (line.startsWith("Title: ")) {
				title = line.slice(7).trim();
			} else if (line.startsWith("URL: ")) {
				url = line.slice(5).trim();
			} else if (line.startsWith("Published: ")) {
				publishedDate = line.slice(11).trim();
				if (publishedDate === "N/A") {
					publishedDate = "";
				}
			} else if (line.startsWith("Highlights:") || line.startsWith("Content:")) {
				inHighlights = true;
			} else if (inHighlights) {
				snippetLines.push(line);
			}
		}

		if (title || url) {
			results.push({
				title,
				url,
				publishedDate: publishedDate || undefined,
				snippet: snippetLines.join("\n").trim() || undefined,
			});
		}
	}

	return results;
}

export function createWebSearchToolDefinition(
	_cwd: string,
	options?: WebSearchToolOptions,
): ToolDefinition<typeof webSearchSchema, WebSearchToolDetails> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web using Exa's neural search engine. Returns titles, URLs, and text snippets for each result. Requires the EXA_API_KEY environment variable (free API key at https://exa.ai).",
		promptSnippet: "Search the web via Exa neural search (requires EXA_API_KEY)",
		parameters: webSearchSchema,

		async execute(_toolCallId, { query, numResults = 5, type = "neural" }, signal) {
			const apiKey = options?.apiKey ?? process.env.EXA_API_KEY;
			const clampedNumResults = Math.min(Math.max(1, numResults), 10);

			let results: WebSearchResult[] = [];

			if (!apiKey) {
				const mcpUrl = "https://mcp.exa.ai/mcp";
				let response: Response;
				try {
					response = await fetch(mcpUrl, {
						method: "POST",
						signal,
						headers: {
							"Content-Type": "application/json",
							Accept: "application/json, text/event-stream",
						},
						body: JSON.stringify({
							jsonrpc: "2.0",
							id: "1",
							method: "tools/call",
							params: {
								name: "web_search_exa",
								arguments: {
									query,
									numResults: clampedNumResults,
								},
							},
						}),
					});
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					throw new Error(
						`web_search requires an Exa API key or a working connection to remote MCP. Network error calling Exa MCP: ${msg}`,
					);
				}

				if (!response.ok) {
					const errText = await response.text().catch(() => "");
					throw new Error(
						`web_search requires an Exa API key or a working connection to remote MCP. Exa MCP returned HTTP ${response.status}: ${errText.slice(0, 300)}`,
					);
				}

				const text = await response.text();
				const lines = text.split("\n");
				let dataObj: McpToolCallResponse | null = null;
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							dataObj = JSON.parse(line.slice(6).trim()) as McpToolCallResponse;
							break;
						} catch {
							// ignore
						}
					}
				}

				if (dataObj?.error) {
					const errorMsg =
						typeof dataObj.error === "object"
							? dataObj.error.message || JSON.stringify(dataObj.error)
							: String(dataObj.error);
					throw new Error(`Exa MCP error: ${errorMsg}`);
				}

				if (!dataObj?.result?.content) {
					throw new Error("Invalid response format from Exa MCP server");
				}

				const textResult = dataObj.result.content.map((c) => c.text).join("\n\n");
				results = parseMcpSearchResults(textResult);
			} else {
				let response: Response;
				try {
					response = await fetch(EXA_SEARCH_URL, {
						method: "POST",
						signal,
						headers: {
							"Content-Type": "application/json",
							"x-api-key": apiKey,
						},
						body: JSON.stringify({
							query,
							numResults: clampedNumResults,
							type,
							contents: { snippet: true },
						}),
					});
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					throw new Error(`Network error calling Exa: ${msg}`);
				}

				if (!response.ok) {
					const errText = await response.text().catch(() => "");
					throw new Error(`Exa search returned HTTP ${response.status}: ${errText.slice(0, 300)}`);
				}

				let data: {
					results?: Array<{ title?: string; url?: string; publishedDate?: string; snippet?: string }>;
				};
				try {
					data = (await response.json()) as typeof data;
				} catch {
					throw new Error("Error parsing Exa response");
				}

				results = (data.results ?? []).map((r) => ({
					title: r.title ?? "",
					url: r.url ?? "",
					publishedDate: r.publishedDate,
					snippet: r.snippet,
				}));
			}

			if (results.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No results found." }],
					details: { query, numResults: 0, results: [] },
				};
			}

			const lines = results.map((r, i) => {
				let line = `${i + 1}. ${r.title}\n   ${r.url}`;
				if (r.publishedDate) line += ` (${r.publishedDate.slice(0, 10)})`;
				if (r.snippet) line += `\n   ${r.snippet.trim()}`;
				return line;
			});

			return {
				content: [{ type: "text" as const, text: lines.join("\n\n") }],
				details: { query, numResults: results.length, results },
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const query = args?.query ?? "";
			text.setText(`${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", query)}`);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as WebSearchToolDetails | undefined;
			if (context.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("warning", msg.slice(0, 120)));
			} else {
				const count = details?.numResults ?? 0;
				text.setText(
					theme.fg("toolOutput", `${count} result${count === 1 ? "" : "s"} for "${details?.query ?? ""}"`),
				);
			}
			return text;
		},
	};
}

export function createWebSearchTool(_cwd: string, options?: WebSearchToolOptions): AgentTool<typeof webSearchSchema> {
	return wrapToolDefinition(createWebSearchToolDefinition(_cwd, options));
}
