import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebSocket as UndiciWebSocket } from "undici";
import {
	ensureBrowserLaunched,
	formatCdpConnectionError,
	isCdpConnectionError,
	shouldAutoLaunchBrowser,
} from "./browser-launch.ts";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface WebSocketLike {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: "open" | "message" | "error" | "close", listener: (event?: { data?: unknown }) => void): void;
	removeEventListener(
		type: "open" | "message" | "error" | "close",
		listener: (event?: { data?: unknown }) => void,
	): void;
}

function getWebSocketConstructor(): WebSocketConstructor {
	const globalCtor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
	if (globalCtor) {
		return globalCtor;
	}
	return UndiciWebSocket as unknown as WebSocketConstructor;
}

export interface CdpTab {
	id: string;
	title: string;
	url: string;
	type: string;
	webSocketDebuggerUrl: string;
}

interface CdpResponse {
	id?: number;
	result?: unknown;
	error?: { message?: string; code?: number; data?: unknown };
}

type WebSocketLikeInstance = InstanceType<WebSocketConstructor>;

type CdpEventHandler = (params: unknown) => void;

const sessionCache = new Map<string, CdpSession>();

export function getBrowserCdpBaseUrl(): string {
	return process.env.FLAME_BROWSER_CDP_URL?.trim() || DEFAULT_CDP_URL;
}

function assertAllowedCdpUrl(baseUrl: string): URL {
	const parsed = new URL(baseUrl);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Browser CDP URL must be http(s): ${baseUrl}`);
	}
	const allowRemote = process.env.FLAME_BROWSER_ALLOW_REMOTE === "1";
	const host = parsed.hostname.toLowerCase();
	const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
	if (!isLocal && !allowRemote) {
		throw new Error(
			`Browser CDP URL must be localhost (set FLAME_BROWSER_ALLOW_REMOTE=1 for remote debugging): ${baseUrl}`,
		);
	}
	return parsed;
}

function cdpHttpUrl(baseUrl: string, path: string): string {
	const root = assertAllowedCdpUrl(baseUrl);
	return new URL(path, root).toString();
}

async function cdpHttpRequestRaw(url: string, method: "GET" | "PUT"): Promise<{ statusCode: number; body: string }> {
	const parsed = new URL(url);
	const requestFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
	return new Promise((resolve, reject) => {
		const req = requestFn(
			parsed,
			{
				method,
				headers: method === "PUT" ? { "Content-Length": "0" } : undefined,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
				});
				res.on("end", () => {
					resolve({ statusCode: res.statusCode ?? 0, body });
				});
			},
		);
		req.on("error", reject);
		req.end(method === "PUT" ? "" : undefined);
	});
}

async function cdpHttpRequest(
	baseUrl: string,
	path: string,
	method: "GET" | "PUT" = "GET",
	allowLaunch = true,
): Promise<Response> {
	const url = cdpHttpUrl(baseUrl, path);
	let result: { statusCode: number; body: string };
	try {
		result = await cdpHttpRequestRaw(url, method);
	} catch (error) {
		if (allowLaunch && shouldAutoLaunchBrowser() && isCdpConnectionError(error)) {
			try {
				const launched = await ensureBrowserLaunched(baseUrl);
				if (launched) {
					return cdpHttpRequest(baseUrl, path, method, false);
				}
			} catch (launchError) {
				throw new Error(formatCdpConnectionError(baseUrl, launchError, true));
			}
		}
		throw new Error(formatCdpConnectionError(baseUrl, error, false));
	}
	if (result.statusCode < 200 || result.statusCode >= 300) {
		throw new Error(`Browser CDP HTTP ${result.statusCode} for ${path}: ${result.body.slice(0, 300)}`);
	}
	return new Response(result.body, { status: result.statusCode });
}

async function cdpHttpGet(baseUrl: string, path: string, allowLaunch = true): Promise<Response> {
	return cdpHttpRequest(baseUrl, path, "GET", allowLaunch);
}

export async function listCdpTabs(baseUrl = getBrowserCdpBaseUrl()): Promise<CdpTab[]> {
	const response = await cdpHttpGet(baseUrl, "/json/list");
	const tabs = (await response.json()) as CdpTab[];
	return tabs.filter((tab) => Boolean(tab.id && tab.webSocketDebuggerUrl));
}

export async function openCdpTab(url: string | undefined, baseUrl = getBrowserCdpBaseUrl()): Promise<CdpTab> {
	const path = url ? `/json/new?${encodeURIComponent(url)}` : "/json/new";
	const response = await cdpHttpRequest(baseUrl, path, "PUT");
	const tab = (await response.json()) as CdpTab;
	if (!tab.id || !tab.webSocketDebuggerUrl) {
		throw new Error("Browser CDP did not return a new tab descriptor");
	}
	return tab;
}

export async function closeCdpTab(tabId: string, baseUrl = getBrowserCdpBaseUrl()): Promise<void> {
	sessionCache.get(tabId)?.close();
	sessionCache.delete(tabId);
	await cdpHttpGet(baseUrl, `/json/close/${encodeURIComponent(tabId)}`);
}

export async function activateCdpTab(tabId: string, baseUrl = getBrowserCdpBaseUrl()): Promise<void> {
	await cdpHttpGet(baseUrl, `/json/activate/${encodeURIComponent(tabId)}`);
}

export async function resolveCdpTab(tabId: string | undefined, baseUrl = getBrowserCdpBaseUrl()): Promise<CdpTab> {
	const tabs = await listCdpTabs(baseUrl);
	if (tabs.length === 0) {
		throw new Error("No browser tabs are available on the CDP endpoint");
	}
	if (!tabId) {
		const page = tabs.find((tab) => tab.type === "page") ?? tabs[0];
		return page;
	}
	const tab = tabs.find((entry) => entry.id === tabId);
	if (!tab) {
		const available = tabs.map((entry) => entry.id).join(", ");
		throw new Error(`Tab ${tabId} was not found. Available tabs: ${available}`);
	}
	return tab;
}

export class CdpSession {
	private ws: WebSocketLikeInstance;
	private nextId = 1;
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private eventHandlers = new Map<string, Set<CdpEventHandler>>();
	private closed = false;

	private constructor(ws: WebSocketLikeInstance) {
		this.ws = ws;
		ws.addEventListener("message", (event) => {
			if (!event) {
				return;
			}
			this.handleMessage(String(event.data ?? ""));
		});
		ws.addEventListener("close", () => {
			this.failPending(new Error("Browser CDP connection closed"));
			this.closed = true;
		});
		ws.addEventListener("error", () => {
			this.failPending(new Error("Browser CDP connection error"));
		});
	}

	static async connect(tab: CdpTab): Promise<CdpSession> {
		const cached = sessionCache.get(tab.id);
		if (cached && !cached.closed) {
			return cached;
		}
		const WebSocketCtor = getWebSocketConstructor();
		const ws = new WebSocketCtor(tab.webSocketDebuggerUrl);
		await new Promise<void>((resolve, reject) => {
			const onOpen = () => {
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error(`Failed to connect to browser tab ${tab.id}`));
			};
			const cleanup = () => {
				ws.removeEventListener("open", onOpen);
				ws.removeEventListener("error", onError);
			};
			ws.addEventListener("open", onOpen);
			ws.addEventListener("error", onError);
		});
		const session = new CdpSession(ws);
		sessionCache.set(tab.id, session);
		return session;
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.failPending(new Error("Browser CDP session closed"));
		try {
			this.ws.close();
		} catch {
			// ignore
		}
	}

	async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		if (this.closed) {
			throw new Error("Browser CDP session is closed");
		}
		const id = this.nextId++;
		const payload = JSON.stringify({ id, method, params });
		const result = await new Promise<unknown>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(payload);
		});
		return result as T;
	}

	onEvent(method: string, handler: CdpEventHandler): () => void {
		let handlers = this.eventHandlers.get(method);
		if (!handlers) {
			handlers = new Set();
			this.eventHandlers.set(method, handlers);
		}
		handlers.add(handler);
		return () => {
			handlers?.delete(handler);
		};
	}

	private handleMessage(raw: string): void {
		let message: CdpResponse & { method?: string; params?: unknown };
		try {
			message = JSON.parse(raw) as CdpResponse & { method?: string; params?: unknown };
		} catch {
			return;
		}
		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}
			this.pending.delete(message.id);
			if (message.error) {
				pending.reject(new Error(message.error.message || `CDP error ${message.error.code ?? "unknown"}`));
				return;
			}
			pending.resolve(message.result);
			return;
		}
		if (message.method) {
			const handlers = this.eventHandlers.get(message.method);
			if (!handlers) {
				return;
			}
			for (const handler of handlers) {
				handler(message.params);
			}
		}
	}

	private failPending(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}

export function clearCdpSessionCache(): void {
	for (const [tabId, session] of sessionCache.entries()) {
		session.close();
		sessionCache.delete(tabId);
	}
}

export async function withCdpSession<T>(
	tabId: string | undefined,
	baseUrl: string,
	fn: (session: CdpSession, tab: CdpTab) => Promise<T>,
): Promise<T> {
	const tab = await resolveCdpTab(tabId, baseUrl);
	const session = await CdpSession.connect(tab);
	return fn(session, tab);
}

export async function evaluateExpression(
	session: CdpSession,
	expression: string,
	awaitPromise = true,
): Promise<unknown> {
	await session.send("Runtime.enable");
	const result = await session.send<{
		result?: { value?: unknown; description?: string; type?: string };
		exceptionDetails?: { text?: string; exception?: { description?: string } };
	}>("Runtime.evaluate", {
		expression,
		awaitPromise,
		returnByValue: true,
		userGesture: true,
	});
	if (result.exceptionDetails) {
		const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "eval failed";
		throw new Error(detail);
	}
	const remote = result.result;
	if (!remote) {
		return undefined;
	}
	if (remote.type === "undefined") {
		return undefined;
	}
	if (remote.value !== undefined) {
		return remote.value;
	}
	if (remote.type === "object" && remote.description) {
		try {
			return JSON.parse(remote.description) as unknown;
		} catch {
			// fall through
		}
	}
	return remote.description;
}
