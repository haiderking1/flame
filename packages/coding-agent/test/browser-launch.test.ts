import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isCdpConnectionError,
	parseCdpPort,
	resetBrowserLaunchStateForTests,
	shouldAutoLaunchBrowser,
	waitForCdpReady,
} from "../src/core/tools/browser-launch.ts";

describe("browser launch", () => {
	afterEach(() => {
		resetBrowserLaunchStateForTests();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("parses CDP port from URL", () => {
		expect(parseCdpPort("http://127.0.0.1:9222")).toBe(9222);
		expect(parseCdpPort("http://127.0.0.1")).toBe(9222);
		expect(parseCdpPort("http://127.0.0.1:9333")).toBe(9333);
	});

	it("detects fetch connection errors", () => {
		expect(isCdpConnectionError(new TypeError("fetch failed"))).toBe(true);
		expect(isCdpConnectionError(new Error("connect ECONNREFUSED 127.0.0.1:9222"))).toBe(true);
		expect(isCdpConnectionError(new Error("bad selector"))).toBe(false);
	});

	it("respects FLAME_BROWSER_AUTO_LAUNCH=0", () => {
		vi.stubEnv("FLAME_BROWSER_AUTO_LAUNCH", "0");
		expect(shouldAutoLaunchBrowser()).toBe(false);
	});

	it("waits until CDP /json/version responds", async () => {
		let attempts = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				attempts += 1;
				if (attempts < 3) {
					throw new TypeError("fetch failed");
				}
				return new Response(JSON.stringify({ Browser: "Chrome" }), { status: 200 });
			}),
		);

		await expect(waitForCdpReady("http://127.0.0.1:9222", 2_000)).resolves.toBe(true);
		expect(attempts).toBeGreaterThanOrEqual(3);
	});

	it("resolves browser executable from FLAME_BROWSER_EXECUTABLE", () => {
		const dir = mkdtempSync(join(tmpdir(), "flame-browser-exe-"));
		const exePath = join(dir, process.platform === "win32" ? "chrome.exe" : "chrome");
		writeFileSync(exePath, "");
		vi.stubEnv("FLAME_BROWSER_EXECUTABLE", exePath);

		return import("../src/core/tools/browser-launch.ts").then((mod) => {
			expect(mod.resolveBrowserExecutable()).toBe(exePath);
		});
	});
});
