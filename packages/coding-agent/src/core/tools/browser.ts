import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentTool } from "@earendil-works/flame-agent-core";
import { Text } from "@earendil-works/flame-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	activateCdpTab,
	closeCdpTab,
	evaluateExpression,
	getBrowserCdpBaseUrl,
	listCdpTabs,
	openCdpTab,
	resolveCdpTab,
	withCdpSession,
} from "./browser-cdp.ts";
import { type ClickPlan, clickElementWithFeedback } from "./browser-click.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { truncateTail } from "./truncate.ts";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SCRAPE_BYTES = 50 * 1024;
const MAX_ELEMENT_LIST = 50;

type ScrapeFormat = "text" | "html" | "links" | "elements";

const browserSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("list"),
			Type.Literal("open"),
			Type.Literal("close"),
			Type.Literal("activate"),
			Type.Literal("cdp"),
			Type.Literal("eval"),
			Type.Literal("scrape"),
			Type.Literal("download"),
		],
		{
			description:
				"Browser action: list/open/close/activate tabs, raw cdp, eval (including clicks), scrape, or download via page fetch",
		},
	),
	tabId: Type.Optional(Type.String({ description: "Target tab id from list/open (defaults to first page tab)" })),
	url: Type.Optional(Type.String({ description: "URL for open, navigate (cdp Page.navigate), or download" })),
	expression: Type.Optional(
		Type.String({
			description: "JavaScript for eval. Omit to click selector via eval (document.querySelector(...).click()).",
		}),
	),
	method: Type.Optional(Type.String({ description: "Raw CDP method name for cdp action" })),
	params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Raw CDP params for cdp action" })),
	selector: Type.Optional(
		Type.String({
			description:
				"CSS selector (standard CSS only, not jQuery). For eval: click target. For scrape format=elements: list matches.",
		}),
	),
	index: Type.Optional(
		Type.Number({
			description: "Zero-based match index when selector matches multiple elements (eval click, default: 0)",
			minimum: 0,
		}),
	),
	format: Type.Optional(
		Type.Union([Type.Literal("text"), Type.Literal("html"), Type.Literal("links"), Type.Literal("elements")], {
			description: "Scrape output format (default: text). elements lists clickable targets or selector matches.",
		}),
	),
	savePath: Type.Optional(
		Type.String({ description: "Output path for download action (relative to cwd unless absolute)" }),
	),
	awaitPromise: Type.Optional(Type.Boolean({ description: "Await promises in eval expressions (default: true)" })),
});

export type BrowserToolInput = Static<typeof browserSchema>;

export interface BrowserTabSummary {
	id: string;
	title: string;
	url: string;
	type: string;
}

export interface BrowserToolDetails {
	action: BrowserToolInput["action"];
	tabId?: string;
	url?: string;
	selector?: string;
	savePath?: string;
	tabs?: BrowserTabSummary[];
	result?: unknown;
	bytes?: number;
	truncated?: boolean;
}

export interface BrowserToolOptions {
	cdpUrl?: string;
}

function resolveSavePath(cwd: string, savePath: string): string {
	return path.isAbsolute(savePath) ? savePath : path.resolve(cwd, savePath);
}

function formatTabs(tabs: BrowserTabSummary[]): string {
	if (tabs.length === 0) {
		return "No tabs.";
	}
	return tabs.map((tab) => `${tab.id} [${tab.type}] ${tab.title} - ${tab.url}`).join("\n");
}

function truncateScrape(text: string): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf8") <= MAX_SCRAPE_BYTES) {
		return { text, truncated: false };
	}
	const result = truncateTail(text, { maxBytes: MAX_SCRAPE_BYTES, maxLines: 2000 });
	return { text: result.content, truncated: result.truncated };
}

export function validateCssSelector(selector: string): void {
	if (/:contains\s*\(/i.test(selector)) {
		throw new Error(
			`Invalid CSS selector "${selector}": :contains() is jQuery syntax, not valid CSS. Use scrape format=elements to list matches, then click with a standard selector and optional index.`,
		);
	}
}

const CLICKABLE_ELEMENTS_SELECTOR =
	'a[href], button, [role="button"], input[type="submit"], input[type="button"], [onclick]';

export function looksLikeCssSelectorOnly(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed || trimmed.includes("(") || trimmed.includes(";")) {
		return false;
	}
	if (/^(document|window|return|function|const|let|var|if|for|while|async|await)\b/i.test(trimmed)) {
		return false;
	}
	return /^([.#[]|[a-zA-Z_*])/.test(trimmed);
}

export function parseQuerySelectorClickExpression(expression: string): { selector: string; index: number } | undefined {
	const trimmed = expression.trim();
	const allMatch = trimmed.match(
		/^document\.querySelectorAll\(\s*(['"`])([\s\S]*?)\1\s*\)\s*\[\s*(\d+)\s*\]\.click\(\)\s*$/,
	);
	if (allMatch) {
		return { selector: allMatch[2], index: Number(allMatch[3]) };
	}
	const oneMatch = trimmed.match(/^document\.querySelector\(\s*(['"`])([\s\S]*?)\1\s*\)\.click\(\)\s*$/);
	if (oneMatch) {
		return { selector: oneMatch[2], index: 0 };
	}
	return undefined;
}

export function resolveClickPlan(
	args: Pick<BrowserToolInput, "expression" | "selector" | "index">,
): ClickPlan | undefined {
	if (args.selector) {
		validateCssSelector(args.selector);
		return { selector: args.selector, index: args.index ?? 0 };
	}

	const expression = args.expression?.trim();
	if (!expression) {
		if (args.index !== undefined) {
			return { index: args.index };
		}
		return undefined;
	}

	if (looksLikeCssSelectorOnly(expression)) {
		validateCssSelector(expression);
		return { selector: expression, index: args.index ?? 0 };
	}

	const parsedClick = parseQuerySelectorClickExpression(expression);
	if (parsedClick) {
		validateCssSelector(parsedClick.selector);
		return { selector: parsedClick.selector, index: parsedClick.index };
	}

	return undefined;
}

export function resolveEvalExpression(args: Pick<BrowserToolInput, "expression" | "selector" | "index">): string {
	const clickPlan = resolveClickPlan(args);
	if (clickPlan) {
		throw new Error("Internal error: click plans must use clickElementWithFeedback");
	}

	const expression = args.expression?.trim();
	if (!expression) {
		throw new Error("expression, selector, or index is required for eval action");
	}

	if (/\b\.click\s*\(\s*\)\s*$/.test(expression)) {
		throw new Error(
			"Bare .click() expressions return undefined. Use selector (e.g. selector=.btn-hero-primary) or index from scrape format=elements instead of a raw click expression.",
		);
	}

	return expression;
}

export function formatEvalResultText(result: unknown): string {
	if (result === undefined) {
		return "undefined";
	}
	if (typeof result === "object" && result !== null && (result as { clicked?: boolean }).clicked) {
		const click = result as {
			tag?: string;
			text?: string;
			href?: string;
			className?: string;
			index?: number;
			matchCount?: number;
			selector?: string;
			download?: { started?: boolean; filename?: string; url?: string };
		};
		const lines = [
			"Clicked element:",
			click.tag ? `  tag: ${click.tag}` : undefined,
			click.className ? `  class: ${click.className}` : undefined,
			click.text ? `  text: ${click.text}` : undefined,
			click.href ? `  href: ${click.href}` : undefined,
			click.selector ? `  selector: ${click.selector}` : undefined,
			click.index !== undefined
				? `  index: ${click.index}${click.matchCount !== undefined ? ` of ${click.matchCount}` : ""}`
				: undefined,
			click.download?.started
				? `  download started: ${click.download.filename ?? "unknown file"}${click.download.url ? `\n  download url: ${click.download.url}` : ""}`
				: undefined,
		].filter((line): line is string => line !== undefined);
		return lines.join("\n");
	}
	return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function buildScrapeExpression(selector: string | undefined, format: ScrapeFormat): string {
	if (format === "elements") {
		if (selector) {
			const selectorJson = JSON.stringify(selector);
			return `(() => {
				let matches;
				try {
					matches = document.querySelectorAll(${selectorJson});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error("Invalid CSS selector: ${selector}. " + message + " (:contains() is jQuery, not CSS.)");
				}
				return Array.from(matches).slice(0, ${MAX_ELEMENT_LIST}).map((el, index) => ({
					index,
					tag: el.tagName,
					id: el.id || undefined,
					className: typeof el.className === "string" && el.className.length > 0 ? el.className : undefined,
					href: el.href || el.getAttribute("href") || undefined,
					text: (el.textContent || "").trim().slice(0, 200) || undefined,
				}));
			})()`;
		}
		return `(() => {
			const candidates = Array.from(document.querySelectorAll(${JSON.stringify(CLICKABLE_ELEMENTS_SELECTOR)}));
			return candidates.slice(0, ${MAX_ELEMENT_LIST}).map((el, index) => ({
				index,
				tag: el.tagName,
				id: el.id || undefined,
				className: typeof el.className === "string" && el.className.length > 0 ? el.className : undefined,
				href: el.href || el.getAttribute("href") || undefined,
				text: (el.textContent || "").trim().slice(0, 200) || undefined,
				role: el.getAttribute("role") || undefined,
				type: el.getAttribute("type") || undefined,
			}));
		})()`;
	}
	if (format === "html") {
		const target = selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.documentElement";
		return `(() => { const node = ${target}; if (!node) return null; return node.outerHTML ?? node.textContent ?? ""; })()`;
	}
	if (format === "links") {
		const root = selector ? `document.querySelector(${JSON.stringify(selector)})` : "document";
		return `(() => {
			const root = ${root};
			if (!root) return [];
			const anchors = root.querySelectorAll ? root.querySelectorAll("a[href]") : [];
			return Array.from(anchors).map((a) => ({
				href: a.href,
				text: (a.textContent || "").trim(),
			}));
		})()`;
	}
	const target = selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.body";
	return `(() => { const node = ${target}; if (!node) return null; return node.innerText ?? node.textContent ?? ""; })()`;
}

async function downloadViaPageFetch(
	cwd: string,
	tabId: string | undefined,
	url: string,
	savePath: string,
	baseUrl: string,
): Promise<{ savePath: string; bytes: number }> {
	const destination = resolveSavePath(cwd, savePath);
	mkdirSync(path.dirname(destination), { recursive: true });
	const payload = await withCdpSession(tabId, baseUrl, async (session) => {
		return evaluateExpression(
			session,
			`(async () => {
				const res = await fetch(${JSON.stringify(url)}, { credentials: "include" });
				const contentType = res.headers.get("content-type") || "";
				const ab = await res.arrayBuffer();
				if (ab.byteLength > ${MAX_DOWNLOAD_BYTES}) {
					throw new Error("Download exceeds ${MAX_DOWNLOAD_BYTES} bytes");
				}
				const bytes = Array.from(new Uint8Array(ab));
				return { ok: res.ok, status: res.status, contentType, bytes };
			})()`,
			true,
		);
	});
	if (!payload || typeof payload !== "object") {
		throw new Error("Browser download returned no data");
	}
	const result = payload as { ok?: boolean; status?: number; bytes?: number[] };
	if (!result.ok) {
		throw new Error(`Browser download failed with HTTP ${result.status ?? "unknown"}`);
	}
	if (!Array.isArray(result.bytes)) {
		throw new Error("Browser download returned invalid payload");
	}
	const buffer = Buffer.from(result.bytes);
	writeFileSync(destination, buffer);
	return { savePath: destination, bytes: buffer.length };
}

export function createBrowserToolDefinition(
	cwd: string,
	options?: BrowserToolOptions,
): ToolDefinition<typeof browserSchema, BrowserToolDetails> {
	return {
		name: "browser",
		label: "browser",
		description: [
			"Control a Chrome/Edge browser over CDP (remote debugging port).",
			"Auto-launches Chrome/Edge on first use if nothing is listening (disable with FLAME_BROWSER_AUTO_LAUNCH=0).",
			"Tab list/open/close/activate are instant HTTP calls with no polling.",
			"Use eval with selector/index for clicks (CDP mouse events + download detection), cdp for raw protocol calls.",
			"Scrape format=elements lists clickable targets or all selector matches before clicking.",
			"Requires Chrome/Edge. Default CDP URL http://127.0.0.1:9222 (FLAME_BROWSER_CDP_URL).",
			"Override browser binary with FLAME_BROWSER_EXECUTABLE if auto-detection fails.",
		].join(" "),
		promptSnippet: "Drive Chrome/Edge via CDP: tabs, eval (clicks), scrape, download",
		promptGuidelines: [
			"For browser clicks use eval with selector (not expression): selector=.btn-primary or index=22 after scrape format=elements.",
			"Before clicking ambiguous pages, run browser scrape format=elements to list clickable targets with index/class/href/text.",
		],
		parameters: browserSchema,

		async execute(_toolCallId, args) {
			const baseUrl = options?.cdpUrl || getBrowserCdpBaseUrl();

			if (args.action === "list") {
				const tabs = await listCdpTabs(baseUrl);
				const summaries = tabs.map((tab) => ({
					id: tab.id,
					title: tab.title,
					url: tab.url,
					type: tab.type,
				}));
				return {
					content: [{ type: "text", text: formatTabs(summaries) }],
					details: { action: args.action, tabs: summaries },
				};
			}

			if (args.action === "open") {
				const tab = await openCdpTab(args.url, baseUrl);
				const summary = { id: tab.id, title: tab.title, url: tab.url, type: tab.type };
				return {
					content: [{ type: "text", text: `Opened tab ${tab.id}: ${tab.url}` }],
					details: { action: args.action, tabId: tab.id, url: tab.url, tabs: [summary] },
				};
			}

			if (args.action === "close") {
				const tab = await resolveCdpTab(args.tabId, baseUrl);
				await closeCdpTab(tab.id, baseUrl);
				return {
					content: [{ type: "text", text: `Closed tab ${tab.id}` }],
					details: { action: args.action, tabId: tab.id, url: tab.url },
				};
			}

			if (args.action === "activate") {
				const tab = await resolveCdpTab(args.tabId, baseUrl);
				await activateCdpTab(tab.id, baseUrl);
				return {
					content: [{ type: "text", text: `Activated tab ${tab.id}: ${tab.url}` }],
					details: { action: args.action, tabId: tab.id, url: tab.url },
				};
			}

			if (args.action === "cdp") {
				if (!args.method) {
					throw new Error("method is required for cdp action");
				}
				const method = args.method;
				const result = await withCdpSession(args.tabId, baseUrl, async (session, _tab) => {
					if (method === "Page.navigate") {
						if (!args.url && !(args.params && typeof args.params.url === "string")) {
							throw new Error("url is required for Page.navigate");
						}
						const navigateParams = {
							...(args.params ?? {}),
							url: args.url ?? (args.params?.url as string),
						};
						return session.send(method, navigateParams);
					}
					return session.send(method, args.params ?? {});
				});
				const tab = await resolveCdpTab(args.tabId, baseUrl);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: { action: args.action, tabId: tab.id, url: tab.url, result },
				};
			}

			if (args.action === "eval") {
				const clickPlan = resolveClickPlan(args);
				const rawResult = await withCdpSession(args.tabId, baseUrl, async (session) => {
					if (clickPlan) {
						return clickElementWithFeedback(session, clickPlan);
					}
					const expression = resolveEvalExpression(args);
					return evaluateExpression(session, expression, args.awaitPromise ?? true);
				});
				const tab = await resolveCdpTab(args.tabId, baseUrl);
				const text = formatEvalResultText(rawResult);
				return {
					content: [{ type: "text", text }],
					details: {
						action: args.action,
						tabId: tab.id,
						url: tab.url,
						selector: args.selector,
						result: rawResult,
					},
				};
			}

			if (args.action === "scrape") {
				const format = (args.format ?? "text") as ScrapeFormat;
				if (args.selector && format === "elements") {
					validateCssSelector(args.selector);
				}
				const expression = buildScrapeExpression(args.selector, format);
				const scraped = await withCdpSession(args.tabId, baseUrl, async (session) => {
					return evaluateExpression(session, expression, true);
				});
				const tab = await resolveCdpTab(args.tabId, baseUrl);
				if (scraped == null) {
					throw new Error(
						args.selector ? `Scrape selector not found: ${args.selector}` : "Scrape returned no content",
					);
				}
				if (format === "elements" && Array.isArray(scraped) && scraped.length === 0) {
					throw new Error(
						args.selector
							? `Selector matched no elements: ${args.selector}`
							: "No clickable elements found on page",
					);
				}
				const rawText =
					typeof scraped === "string" ? scraped : (JSON.stringify(scraped, null, 2) ?? String(scraped));
				const truncated = truncateScrape(rawText);
				return {
					content: [{ type: "text", text: truncated.text }],
					details: {
						action: args.action,
						tabId: tab.id,
						url: tab.url,
						selector: args.selector,
						truncated: truncated.truncated,
					},
				};
			}

			if (args.action === "download") {
				if (!args.url) {
					throw new Error("url is required for download action");
				}
				if (!args.savePath) {
					throw new Error("savePath is required for download action");
				}
				const saved = await downloadViaPageFetch(cwd, args.tabId, args.url, args.savePath, baseUrl);
				const tab = await resolveCdpTab(args.tabId, baseUrl);
				return {
					content: [{ type: "text", text: `Downloaded ${saved.bytes} bytes to ${saved.savePath}` }],
					details: {
						action: args.action,
						tabId: tab.id,
						url: args.url,
						savePath: saved.savePath,
						bytes: saved.bytes,
					},
				};
			}

			throw new Error(`Unsupported browser action: ${String(args.action)}`);
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const action = args?.action ?? "browser";
			const target = args?.url || args?.selector || args?.tabId || "";
			text.setText(`${theme.fg("toolTitle", theme.bold("browser"))} ${theme.fg("accent", action)} ${target}`);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as BrowserToolDetails | undefined;
			if (context.isError) {
				const msg = result.content[0]?.type === "text" ? result.content[0].text : "";
				text.setText(theme.fg("warning", msg.slice(0, 120)));
			} else if (options.isPartial) {
				text.setText(theme.fg("muted", "Running browser action..."));
			} else if (details?.tabs && details.action === "list") {
				text.setText(theme.fg("toolOutput", `${details.tabs.length} tab(s)`));
			} else {
				text.setText(theme.fg("toolOutput", `${details?.action ?? "browser"} ${details?.tabId ?? ""}`.trim()));
			}
			return text;
		},
	};
}

export function createBrowserTool(cwd: string, options?: BrowserToolOptions): AgentTool<typeof browserSchema> {
	return wrapToolDefinition(createBrowserToolDefinition(cwd, options));
}
