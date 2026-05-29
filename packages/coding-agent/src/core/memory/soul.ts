import { promises as fs } from "node:fs";
import { getSoulPath } from "./paths.ts";
import { scanForThreats } from "./threat-patterns.ts";

const SOUL_MAX_CHARS = 24_000;

export const DEFAULT_AGENT_IDENTITY =
	"You are Flame, an extensible coding agent. You are helpful, knowledgeable, and direct. " +
	"You assist with software engineering tasks — answering questions, writing and editing code, " +
	"analyzing information, and executing actions via your tools. You communicate clearly, admit " +
	"uncertainty when appropriate, and prioritize being genuinely useful over being verbose unless " +
	"otherwise directed below. Be targeted and efficient in your exploration and investigations.";

export async function loadSoulMd(): Promise<string | undefined> {
	const path = getSoulPath();
	let raw: string;
	try {
		raw = await fs.readFile(path, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
	const content = raw.trim();
	if (!content) return undefined;

	const findings = scanForThreats(content, "strict");
	if (findings.length > 0) {
		return `[BLOCKED: SOUL.md contained threat pattern(s): ${findings.join(", ")}. Identity replaced. Inspect ${path} and clean before reloading.]`;
	}

	if (content.length <= SOUL_MAX_CHARS) return content;
	return `${content.slice(0, SOUL_MAX_CHARS)}\n\n[Truncated at ${SOUL_MAX_CHARS.toLocaleString("en-US")} chars — original is longer.]`;
}
