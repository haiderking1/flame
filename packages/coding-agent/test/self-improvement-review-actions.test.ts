import type { AgentMessage } from "@earendil-works/flame-agent-core";
import { describe, expect, it } from "vitest";
import { summarizeReviewActions } from "../src/core/self-improvement/background-review.ts";
import { selectReviewPrompt } from "../src/core/self-improvement/review-prompts.ts";

function toolResult(toolCallId: string, payload: Record<string, unknown>): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "memory",
		content: [{ type: "text", text: JSON.stringify(payload) }],
		isError: false,
		timestamp: 0,
	};
}

describe("selectReviewPrompt", () => {
	it("picks combined / memory / skill prompts and appends the whitelist notice", () => {
		expect(selectReviewPrompt(true, true)).toContain("update two things");
		expect(selectReviewPrompt(true, false)).toContain("consider saving to memory");
		expect(selectReviewPrompt(false, true)).toContain("update the skill library");
		expect(selectReviewPrompt(false, true)).toContain("only call memory and skill management tools");
	});
});

describe("summarizeReviewActions", () => {
	it("collects successful memory + skill actions as labels", () => {
		const review: AgentMessage[] = [
			toolResult("a", { success: true, message: "Entry added.", target: "memory" }),
			toolResult("b", { success: true, message: "Entry added.", target: "user" }),
			toolResult("c", { success: true, message: "Skill 'foo' created." }),
		];
		const actions = summarizeReviewActions(review, []);
		expect(actions).toContain("Memory updated");
		expect(actions).toContain("User profile updated");
		expect(actions).toContain("Skill 'foo' created.");
	});

	it("skips tool results inherited from the prior snapshot (dedupe by toolCallId)", () => {
		const snapshot: AgentMessage[] = [toolResult("a", { success: true, message: "Entry added.", target: "memory" })];
		const review: AgentMessage[] = [
			toolResult("a", { success: true, message: "Entry added.", target: "memory" }), // inherited
			toolResult("z", { success: true, message: "Entry added.", target: "memory" }), // new
		];
		const actions = summarizeReviewActions(review, snapshot);
		expect(actions).toEqual(["Memory updated"]); // only the new one
	});

	it("ignores failed and non-tool messages", () => {
		const review: AgentMessage[] = [
			toolResult("a", { success: false, message: "Entry added.", target: "memory" }),
			{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
		];
		expect(summarizeReviewActions(review, [])).toEqual([]);
	});
});
