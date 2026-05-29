import { describe, expect, it } from "vitest";
import { type AgentConfig, resolveSubagentModel } from "../examples/extensions/subagent/agents.ts";

function agent(overrides: Partial<AgentConfig>): AgentConfig {
	return {
		name: "scout",
		description: "test",
		systemPrompt: "test",
		source: "user",
		filePath: "/tmp/scout.md",
		...overrides,
	};
}

describe("resolveSubagentModel", () => {
	it("parses provider/model refs", () => {
		expect(resolveSubagentModel(agent({ model: "ollama/gpt-oss:120b" }))).toEqual({
			provider: "ollama",
			model: "gpt-oss:120b",
		});
	});

	it("uses separate provider and model fields", () => {
		expect(resolveSubagentModel(agent({ provider: "ollama", model: "llama3.2:3b" }))).toEqual({
			provider: "ollama",
			model: "llama3.2:3b",
		});
	});

	it("prefers per-agent env overrides", () => {
		const previous = process.env.FLAME_SUBAGENT_SCOUT_MODEL;
		process.env.FLAME_SUBAGENT_SCOUT_MODEL = "ollama/qwen2.5-coder:7b";
		try {
			expect(resolveSubagentModel(agent({ provider: "ollama", model: "gpt-oss:120b" }))).toEqual({
				provider: "ollama",
				model: "qwen2.5-coder:7b",
			});
		} finally {
			if (previous === undefined) {
				delete process.env.FLAME_SUBAGENT_SCOUT_MODEL;
			} else {
				process.env.FLAME_SUBAGENT_SCOUT_MODEL = previous;
			}
		}
	});

	it("inherits the parent session model when no override is set", () => {
		expect(resolveSubagentModel(agent({}), { provider: "ollama", id: "glm-5.1" })).toEqual({
			provider: "ollama",
			model: "glm-5.1",
		});
	});
});
