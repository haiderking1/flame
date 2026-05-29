import { type CdpSession, evaluateExpression } from "./browser-cdp.ts";

const CLICKABLE_ELEMENTS_SELECTOR =
	'a[href], button, [role="button"], input[type="submit"], input[type="button"], [onclick]';
const DOWNLOAD_WAIT_MS = 3_000;

export interface ClickPlan {
	selector?: string;
	index: number;
}

export interface ClickProbe {
	x: number;
	y: number;
	tag: string;
	id?: string;
	className?: string;
	href?: string;
	text?: string;
	selector?: string;
	index: number;
	matchCount: number;
}

export interface ClickFeedback extends ClickProbe {
	clicked: true;
	download?: {
		started: true;
		filename?: string;
		url?: string;
	};
}

function buildClickProbeExpression(plan: ClickPlan): string {
	if (plan.selector) {
		const selectorJson = JSON.stringify(plan.selector);
		return `(() => {
			let matches;
			try {
				matches = document.querySelectorAll(${selectorJson});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error("Invalid CSS selector: ${plan.selector}. " + message);
			}
			const matchCount = matches.length;
			if (matchCount === 0) {
				throw new Error("Selector not found: ${plan.selector}");
			}
			const index = ${plan.index};
			if (index < 0 || index >= matchCount) {
				throw new Error("Selector ${plan.selector} matched " + matchCount + " element(s), but index " + index + " is out of range");
			}
			const el = matches[index];
			el.scrollIntoView({ block: "center", inline: "center" });
			const rect = el.getBoundingClientRect();
			return JSON.stringify({
				x: rect.left + rect.width / 2,
				y: rect.top + rect.height / 2,
				tag: el.tagName,
				id: el.id || undefined,
				className: typeof el.className === "string" && el.className.length > 0 ? el.className : undefined,
				href: el.href || el.getAttribute("href") || undefined,
				text: (el.textContent || "").trim().slice(0, 200) || undefined,
				selector: ${selectorJson},
				index,
				matchCount,
			});
		})()`;
	}

	return `(() => {
		const candidates = Array.from(document.querySelectorAll(${JSON.stringify(CLICKABLE_ELEMENTS_SELECTOR)}));
		const index = ${plan.index};
		if (index < 0 || index >= candidates.length) {
			throw new Error("Element index " + index + " is out of range (" + candidates.length + " clickable elements)");
		}
		const el = candidates[index];
		el.scrollIntoView({ block: "center", inline: "center" });
		const rect = el.getBoundingClientRect();
		return JSON.stringify({
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
			tag: el.tagName,
			id: el.id || undefined,
			className: typeof el.className === "string" && el.className.length > 0 ? el.className : undefined,
			href: el.href || el.getAttribute("href") || undefined,
			text: (el.textContent || "").trim().slice(0, 200) || undefined,
			index,
			matchCount: candidates.length,
		});
	})()`;
}

function parseClickProbe(raw: unknown): ClickProbe {
	if (typeof raw === "string") {
		return parseClickProbe(JSON.parse(raw) as unknown);
	}
	if (!raw || typeof raw !== "object") {
		throw new Error("Failed to resolve click target on page");
	}
	const probe = raw as Partial<ClickProbe>;
	if (typeof probe.x !== "number" || typeof probe.y !== "number" || typeof probe.tag !== "string") {
		throw new Error("Failed to resolve click target coordinates on page");
	}
	return {
		x: probe.x,
		y: probe.y,
		tag: probe.tag,
		id: probe.id,
		className: probe.className,
		href: probe.href,
		text: probe.text,
		selector: probe.selector,
		index: probe.index ?? 0,
		matchCount: probe.matchCount ?? 1,
	};
}

async function dispatchMouseClick(session: CdpSession, x: number, y: number): Promise<void> {
	const params = { x, y, button: "left", clickCount: 1 };
	await session.send("Input.dispatchMouseEvent", { ...params, type: "mousePressed" });
	await session.send("Input.dispatchMouseEvent", { ...params, type: "mouseReleased" });
}

function waitForDownloadBegin(
	session: CdpSession,
	timeoutMs: number,
): Promise<{ filename?: string; url?: string } | undefined> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: { filename?: string; url?: string } | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			resolve(value);
		};
		const timer = setTimeout(() => finish(undefined), timeoutMs);
		const unsubscribe = session.onEvent("Page.downloadWillBegin", (params) => {
			if (!params || typeof params !== "object") {
				finish(undefined);
				return;
			}
			const event = params as { suggestedFilename?: string; url?: string };
			finish({
				filename: event.suggestedFilename,
				url: event.url,
			});
		});
	});
}

export async function clickElementWithFeedback(session: CdpSession, plan: ClickPlan): Promise<ClickFeedback> {
	await session.send("Page.enable");
	const probe = parseClickProbe(await evaluateExpression(session, buildClickProbeExpression(plan), false));
	const downloadWait = waitForDownloadBegin(session, DOWNLOAD_WAIT_MS);
	await dispatchMouseClick(session, probe.x, probe.y);
	const download = await downloadWait;

	const feedback: ClickFeedback = {
		clicked: true,
		...probe,
	};
	if (download) {
		feedback.download = {
			started: true,
			filename: download.filename,
			url: download.url,
		};
	}
	return feedback;
}
