import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({
	requestMock: vi.fn(),
}));

vi.mock("node:http", () => ({
	request: requestMock,
}));

vi.mock("node:https", () => ({
	request: requestMock,
}));

import {
	createBrowserTool,
	formatEvalResultText,
	looksLikeCssSelectorOnly,
	parseQuerySelectorClickExpression,
	resolveClickPlan,
	validateCssSelector,
} from "../src/core/tools/browser.ts";
import { clearCdpSessionCache } from "../src/core/tools/browser-cdp.ts";

const browserTool = createBrowserTool(process.cwd());

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;
	sent: string[] = [];

	constructor(_url: string) {
		(MockWebSocket as unknown as { lastInstance?: MockWebSocket }).lastInstance = this;
		queueMicrotask(() => {
			this.onopen?.();
		});
	}

	addEventListener(type: string, listener: (event: { data: string }) => void): void {
		if (type === "open") this.onopen = listener as () => void;
		if (type === "message") this.onmessage = listener;
		if (type === "error") this.onerror = listener as () => void;
		if (type === "close") this.onclose = listener as () => void;
	}

	removeEventListener(): void {}

	send(data: string): void {
		this.sent.push(data);
		const parsed = JSON.parse(data) as { id: number; method: string; params?: Record<string, unknown> };
		if (parsed.method === "Runtime.evaluate") {
			const params = parsed.params as { expression?: string } | undefined;
			const expression = params?.expression ?? "";
			if (expression.includes("document.title")) {
				this.onmessage?.({
					data: JSON.stringify({
						id: parsed.id,
						result: { result: { type: "string", value: "hello" } },
					}),
				});
				return;
			}
			this.onmessage?.({
				data: JSON.stringify({
					id: parsed.id,
					result: {
						result: {
							type: "string",
							value: JSON.stringify({
								x: 120,
								y: 240,
								tag: "BUTTON",
								className: "submit",
								text: "Download for Windows",
								selector: "button.submit",
								index: 0,
								matchCount: 1,
							}),
						},
					},
				}),
			});
			return;
		}
		if (parsed.method === "Input.dispatchMouseEvent") {
			this.onmessage?.({
				data: JSON.stringify({
					id: parsed.id,
					result: {},
				}),
			});
			if (parsed.params?.type === "mouseReleased") {
				queueMicrotask(() => {
					this.onmessage?.({
						data: JSON.stringify({
							method: "Page.downloadWillBegin",
							params: {
								suggestedFilename: "fdm_x64_setup.exe",
								url: "https://files2.freedownloadmanager.org/6/latest/fdm_x64_setup.exe",
							},
						}),
					});
				});
			}
			return;
		}
		this.onmessage?.({
			data: JSON.stringify({
				id: parsed.id,
				result: {},
			}),
		});
	}

	close(): void {
		this.onclose?.();
	}
}

function mockHttpResponse(statusCode: number, body: string): IncomingMessage {
	const response = new EventEmitter() as IncomingMessage;
	response.statusCode = statusCode;
	response.setEncoding = () => response;
	queueMicrotask(() => {
		response.emit("data", body);
		response.emit("end");
	});
	return response;
}

function installHttpMock(): void {
	requestMock.mockImplementation((url, options, callback) => {
		const href = typeof url === "string" ? url : url.href;
		const method = (options as { method?: string } | undefined)?.method ?? "GET";
		const request = new EventEmitter() as EventEmitter & { end: (body?: string) => void };
		request.end = () => {
			if (href.endsWith("/json/list")) {
				callback?.(
					mockHttpResponse(
						200,
						JSON.stringify([
							{
								id: "TAB1",
								title: "Example",
								url: "https://example.com",
								type: "page",
								webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TAB1",
							},
						]),
					),
				);
				return;
			}
			if (href.includes("/json/new")) {
				expect(method).toBe("PUT");
				callback?.(
					mockHttpResponse(
						200,
						JSON.stringify({
							id: "TAB2",
							title: "",
							url: "about:blank",
							type: "page",
							webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/TAB2",
						}),
					),
				);
				return;
			}
			if (href.includes("/json/close/")) {
				callback?.(mockHttpResponse(200, "Target closed"));
				return;
			}
			if (href.includes("/json/activate/")) {
				callback?.(mockHttpResponse(200, "Target activated"));
				return;
			}
			callback?.(mockHttpResponse(404, "not found"));
		};
		return request;
	});
}

describe("browser tool", () => {
	beforeEach(() => {
		vi.stubEnv("FLAME_BROWSER_AUTO_LAUNCH", "0");
		installHttpMock();
		vi.stubGlobal("WebSocket", MockWebSocket);
	});

	afterEach(() => {
		requestMock.mockReset();
		clearCdpSessionCache();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("lists tabs instantly from /json/list", async () => {
		const result = await browserTool.execute("call-1", { action: "list" });
		const text = result.content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("TAB1");
		expect(result.details?.tabs?.length).toBe(1);
	});

	it("opens a tab without polling", async () => {
		const result = await browserTool.execute("call-2", { action: "open", url: "https://example.com" });
		const text = result.content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("TAB2");
	});

	it("evaluates JavaScript over CDP", async () => {
		const result = await browserTool.execute("call-3", {
			action: "eval",
			tabId: "TAB1",
			expression: "document.title",
		});
		const text = result.content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("hello");
	});

	it("clicks via CDP Input and reports download feedback", async () => {
		const result = await browserTool.execute("call-4", {
			action: "eval",
			tabId: "TAB1",
			selector: "button.submit",
		});
		const text = result.content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("Download for Windows");
		expect(text).toContain("Clicked element:");
		expect(text).toContain("download started: fdm_x64_setup.exe");
		const sent = (MockWebSocket as unknown as { lastInstance?: MockWebSocket }).lastInstance?.sent ?? [];
		expect(sent.some((payload) => payload.includes("Input.dispatchMouseEvent"))).toBe(true);
	});

	it("rejects jQuery :contains selectors before hitting the page", async () => {
		await expect(
			browserTool.execute("call-5", {
				action: "eval",
				tabId: "TAB1",
				selector: "a:contains('Download')",
			}),
		).rejects.toThrow(/:contains\(\) is jQuery syntax/i);
	});

	it("validates selectors for scrape format=elements", () => {
		expect(() => validateCssSelector("button.primary")).not.toThrow();
		expect(() => validateCssSelector("a:contains('x')")).toThrow(/jQuery syntax/i);
	});

	it("treats bare class selectors as click targets", () => {
		expect(looksLikeCssSelectorOnly(".btn-hero-primary")).toBe(true);
		expect(resolveClickPlan({ expression: ".btn-hero-primary" })).toEqual({
			selector: ".btn-hero-primary",
			index: 0,
		});
	});

	it("clicks by scrape elements index when only index is provided", () => {
		expect(resolveClickPlan({ index: 22 })).toEqual({ index: 22 });
	});

	it("rewrites querySelector click expressions into click plans", () => {
		const parsed = parseQuerySelectorClickExpression("document.querySelector('.btn-hero-primary').click()");
		expect(parsed).toEqual({ selector: ".btn-hero-primary", index: 0 });
		expect(resolveClickPlan({ expression: "document.querySelector('.btn-hero-primary').click()" })).toEqual({
			selector: ".btn-hero-primary",
			index: 0,
		});
	});

	it("formats click results with download confirmation", () => {
		const text = formatEvalResultText({
			clicked: true,
			tag: "A",
			text: "Download for Windows",
			download: { started: true, filename: "fdm_x64_setup.exe", url: "https://example.com/setup.exe" },
		});
		expect(text).toContain("Clicked element:");
		expect(text).toContain("download started: fdm_x64_setup.exe");
	});
});
