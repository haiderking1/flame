/**
 * Integration: the forked background-review agent runs the review prompt, calls
 * the memory tool restricted to its whitelist, and the write lands on disk via
 * the shared MemoryStore. Driven by the faux provider — no real LLM.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/flame-agent-core";
import {
	fauxAssistantMessage,
	fauxToolCall,
	type Message,
	registerFauxProvider,
	streamSimple,
} from "@earendil-works/flame-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/core/memory/memory-store.ts";
import { getMemoryFilePath } from "../src/core/memory/paths.ts";
import { runBackgroundReview } from "../src/core/self-improvement/background-review.ts";

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter((m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

const SNAPSHOT: AgentMessage[] = [
	{ role: "user", content: [{ type: "text", text: "I always want answers in metric units." }], timestamp: 0 },
	{
		role: "assistant",
		content: [{ type: "text", text: "Understood." }],
		api: "faux",
		provider: "faux",
		model: "faux",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	},
];

let flameHomeTemp: string;
let originalFlameHome: string | undefined;

beforeEach(() => {
	flameHomeTemp = mkdtempSync(join(tmpdir(), "flame-bg-review-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = flameHomeTemp;
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	rmSync(flameHomeTemp, { recursive: true, force: true });
});

describe("runBackgroundReview", () => {
	it("writes a memory entry to disk via the shared store and summarizes it", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("memory", { action: "add", target: "user", content: "Prefers metric units." }, { id: "m1" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Saved the preference.", { stopReason: "stop" }),
		]);

		const store = new MemoryStore();
		await store.loadFromDisk();

		try {
			const result = await runBackgroundReview({
				snapshot: SNAPSHOT,
				reviewMemory: true,
				reviewSkills: false,
				memoryStore: store,
				model: faux.getModel(),
				streamFn: streamSimple,
				convertToLlm,
				baseSystemPrompt: "You are Flame.",
				maxIterations: 4,
			});

			expect(result.summary).toBe("User profile updated");
			const onDisk = readFileSync(getMemoryFilePath("user"), "utf-8");
			expect(onDisk).toContain("Prefers metric units.");
		} finally {
			faux.unregister();
		}
	});

	it("swallows errors and returns an empty result when the provider fails", async () => {
		const faux = registerFauxProvider();
		// No responses queued -> the fork's stream errors on first call.
		const store = new MemoryStore();
		await store.loadFromDisk();

		try {
			const result = await runBackgroundReview({
				snapshot: SNAPSHOT,
				reviewMemory: true,
				reviewSkills: false,
				memoryStore: store,
				model: faux.getModel(),
				streamFn: streamSimple,
				convertToLlm,
				baseSystemPrompt: "You are Flame.",
				maxIterations: 2,
			});
			expect(result.summary).toBeUndefined();
			expect(result.actions).toEqual([]);
		} finally {
			faux.unregister();
		}
	});
});
