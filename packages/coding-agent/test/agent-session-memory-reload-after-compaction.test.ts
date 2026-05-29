/**
 * Verifies that successful compaction refreshes the frozen memory snapshot
 * so mid-session disk writes appear in the rebuilt system prompt.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/flame-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeEntries } from "../src/core/memory/drift.ts";
import { getMemoryDir, getMemoryFilePath } from "../src/core/memory/paths.ts";
import { createHarnessWithExtensions } from "./test-harness.ts";

const DISK_ONLY_MARKER = "flame-compaction-reload-disk-marker-7f3a";

let flameHomeTemp: string;
let originalFlameHome: string | undefined;

function seedCompactableSession(harness: Awaited<ReturnType<typeof createHarnessWithExtensions>>): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact" }],
		timestamp: now - 1000,
	});
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: harness.agent.state.model!.api,
		provider: harness.agent.state.model!.provider,
		model: harness.agent.state.model!.id,
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: now - 500,
	};
	harness.sessionManager.appendMessage(assistant);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

beforeEach(() => {
	flameHomeTemp = mkdtempSync(join(tmpdir(), "flame-memory-reload-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = flameHomeTemp;
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	if (flameHomeTemp) {
		rmSync(flameHomeTemp, { recursive: true, force: true });
		flameHomeTemp = "";
	}
});

describe("AgentSession memory reload after compaction", () => {
	it("refreshes the frozen memory snapshot into the system prompt after manual compact", async () => {
		const harness = await createHarnessWithExtensions({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "summary from extension",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: { source: "extension" },
						},
					}));
				},
			],
		});

		try {
			await harness.session.ready();
			seedCompactableSession(harness);

			const promptBeforeDiskWrite = harness.session.agent.state.systemPrompt;
			expect(promptBeforeDiskWrite).not.toContain(DISK_ONLY_MARKER);

			mkdirSync(getMemoryDir(), { recursive: true });
			writeFileSync(getMemoryFilePath("memory"), serializeEntries([DISK_ONLY_MARKER]), "utf-8");

			const promptBeforeCompaction = harness.session.agent.state.systemPrompt;
			expect(promptBeforeCompaction).not.toContain(DISK_ONLY_MARKER);

			await harness.session.compact();

			expect(harness.session.agent.state.systemPrompt).toContain(DISK_ONLY_MARKER);
		} finally {
			harness.cleanup();
		}
	});
});
