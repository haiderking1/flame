import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../config.ts";
import { spawnProcess } from "../../utils/child-process.ts";

const LAUNCH_TIMEOUT_MS = 20_000;
const LAUNCH_POLL_MS = 250;

const WINDOWS_BROWSER_CANDIDATES = [
	join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
	join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
	join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
	join(
		process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
		"Microsoft",
		"Edge",
		"Application",
		"msedge.exe",
	),
];

const MAC_BROWSER_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const LINUX_BROWSER_COMMANDS = [
	"google-chrome-stable",
	"google-chrome",
	"chromium-browser",
	"chromium",
	"microsoft-edge",
];

const launchPromises = new Map<string, Promise<void>>();

export function shouldAutoLaunchBrowser(): boolean {
	return process.env.FLAME_BROWSER_AUTO_LAUNCH !== "0";
}

export function getBrowserProfileDir(): string {
	const override = process.env.FLAME_BROWSER_PROFILE_DIR?.trim();
	const profileDir = override || join(getAgentDir(), "browser-profile");
	mkdirSync(profileDir, { recursive: true });
	return profileDir;
}

export function parseCdpPort(baseUrl: string): number {
	const parsed = new URL(baseUrl);
	if (parsed.port) {
		return Number(parsed.port);
	}
	return 9222;
}

export function resolveBrowserExecutable(): string {
	const override = process.env.FLAME_BROWSER_EXECUTABLE?.trim();
	if (override) {
		if (!existsSync(override)) {
			throw new Error(`FLAME_BROWSER_EXECUTABLE not found: ${override}`);
		}
		return override;
	}

	const fileCandidates =
		process.platform === "win32"
			? WINDOWS_BROWSER_CANDIDATES
			: process.platform === "darwin"
				? MAC_BROWSER_CANDIDATES
				: [];
	for (const candidate of fileCandidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	if (process.platform === "linux") {
		return LINUX_BROWSER_COMMANDS[0];
	}

	throw new Error(
		"No Chrome or Edge executable found. Install Chrome/Edge or set FLAME_BROWSER_EXECUTABLE to the browser binary path.",
	);
}

export function isCdpConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const message = error.message.toLowerCase();
	return (
		message.includes("fetch failed") ||
		message.includes("econnrefused") ||
		message.includes("connection refused") ||
		message.includes("unable to connect") ||
		message.includes("network") ||
		message.includes("timed out")
	);
}

export function formatCdpConnectionError(baseUrl: string, error: unknown, launched: boolean): string {
	const detail = error instanceof Error ? error.message : String(error);
	const manual = `Start Chrome/Edge manually, e.g. chrome --remote-debugging-port=${parseCdpPort(baseUrl)} --user-data-dir="${getBrowserProfileDir()}"`;
	if (launched) {
		return `Could not connect to browser CDP at ${baseUrl} after auto-launch (${detail}). ${manual}`;
	}
	if (shouldAutoLaunchBrowser()) {
		return `Could not connect to browser CDP at ${baseUrl} (${detail}). Auto-launch was attempted but failed. ${manual}`;
	}
	return `Could not connect to browser CDP at ${baseUrl} (${detail}). Set FLAME_BROWSER_AUTO_LAUNCH=1 (default) or ${manual}`;
}

function cdpVersionUrl(baseUrl: string): string {
	return new URL("/json/version", baseUrl).toString();
}

export async function waitForCdpReady(baseUrl: string, timeoutMs = LAUNCH_TIMEOUT_MS): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(cdpVersionUrl(baseUrl), { signal: AbortSignal.timeout(2_000) });
			if (response.ok) {
				return true;
			}
		} catch {
			// keep polling
		}
		await new Promise((resolve) => setTimeout(resolve, LAUNCH_POLL_MS));
	}
	return false;
}

async function launchBrowserOnce(baseUrl: string): Promise<void> {
	const executable = resolveBrowserExecutable();
	const port = parseCdpPort(baseUrl);
	const profileDir = getBrowserProfileDir();
	const args = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profileDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank",
	];

	const child = spawnProcess(executable, args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();

	const ready = await waitForCdpReady(baseUrl);
	if (!ready) {
		throw new Error(
			`Launched ${executable} but CDP did not become ready on ${baseUrl} within ${LAUNCH_TIMEOUT_MS}ms`,
		);
	}
}

export async function ensureBrowserLaunched(baseUrl: string): Promise<boolean> {
	if (!shouldAutoLaunchBrowser()) {
		return false;
	}

	let pending = launchPromises.get(baseUrl);
	if (!pending) {
		pending = launchBrowserOnce(baseUrl);
		launchPromises.set(baseUrl, pending);
	}
	await pending;
	return true;
}

export function resetBrowserLaunchStateForTests(): void {
	launchPromises.clear();
}
