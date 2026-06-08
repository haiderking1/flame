/**
 * Integration: the agent_swarm tool forks one worker Agent per task, runs each
 * to completion on the faux provider, and aggregates their final answers. No
 * real LLM — the faux provider's response queue drives every worker.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/flame-agent-core";
import {
	fauxAssistantMessage,
	fauxToolCall,
	type Message,
	type Model,
	registerFauxProvider,
	streamSimple,
} from "@earendil-works/flame-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AgentSwarmToolDetails,
	type AgentSwarmToolInput,
	buildWorkerToolset,
	createAgentSwarmToolDefinition,
	DEFAULT_SWARM_MAX_DEPTH,
	type SwarmForkContext,
} from "../src/core/tools/agent-swarm.ts";

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter((m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

let flameHomeTemp: string;
let originalFlameHome: string | undefined;

beforeEach(() => {
	flameHomeTemp = mkdtempSync(join(tmpdir(), "flame-swarm-"));
	originalFlameHome = process.env.FLAME_HOME;
	process.env.FLAME_HOME = flameHomeTemp;
});

afterEach(() => {
	if (originalFlameHome === undefined) delete process.env.FLAME_HOME;
	else process.env.FLAME_HOME = originalFlameHome;
	rmSync(flameHomeTemp, { recursive: true, force: true });
});

function makeForkContext(model: Model<any>): SwarmForkContext {
	return {
		model,
		streamFn: streamSimple,
		convertToLlm,
		baseSystemPrompt: "You are a Flame worker.",
		cwd: flameHomeTemp,
	};
}

function getText(result: { content: { type: string }[] }): string {
	const part = result.content.find((c): c is { type: "text"; text: string } => c.type === "text");
	return part?.text ?? "";
}

/** Invoke a tool definition's execute with the 5th (unused) ctx arg the type wants. */
function runSwarm(
	def: ReturnType<typeof createAgentSwarmToolDefinition>,
	params: AgentSwarmToolInput,
	signal?: AbortSignal,
) {
	return def.execute("call", params, signal, undefined, undefined as never);
}

describe("agent_swarm tool", () => {
	it("runs one worker per task and aggregates their final answers in order", async () => {
		const faux = registerFauxProvider();
		// Concurrency 1 makes consumption deterministic: agent-1 then agent-2.
		faux.setResponses([
			fauxAssistantMessage("Result from first agent.", { stopReason: "stop" }),
			fauxAssistantMessage("Result from second agent.", { stopReason: "stop" }),
		]);

		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const params: AgentSwarmToolInput = {
				tasks: [
					{ id: "first", prompt: "Do A" },
					{ id: "second", prompt: "Do B" },
				],
				max_concurrency: 1,
			};
			const result = await runSwarm(def, params);
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers).toHaveLength(2);
			expect(details.workers.map((w) => w.id)).toEqual(["first", "second"]);
			expect(details.workers.every((w) => w.status === "ok")).toBe(true);
			expect(details.workers[0]!.output).toBe("Result from first agent.");
			expect(details.workers[1]!.output).toBe("Result from second agent.");

			const text = getText(result);
			expect(text).toContain("Ran 2 agent(s)");
			expect(text).toContain("## first [ok]");
			expect(text).toContain("Result from first agent.");
			expect(text).toContain("## second [ok]");
		} finally {
			faux.unregister();
		}
	});

	it("captures a worker failure without throwing", async () => {
		const faux = registerFauxProvider();
		// A streamFn that throws drives the worker's prompt() to reject; the swarm
		// must capture it as an error result rather than propagating.
		const throwingContext: SwarmForkContext = {
			...makeForkContext(faux.getModel()!),
			streamFn: () => {
				throw new Error("boom");
			},
		};
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => throwingContext });
			const result = await runSwarm(def, { tasks: [{ prompt: "will fail" }] });
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers).toHaveLength(1);
			expect(details.workers[0]!.status).toBe("error");
			expect(details.workers[0]!.id).toBe("agent-1");
			expect(getText(result)).toContain("## agent-1 [error]");
		} finally {
			faux.unregister();
		}
	});

	it("rejects a batch larger than the worker cap", async () => {
		const faux = registerFauxProvider();
		try {
			const def = createAgentSwarmToolDefinition({
				getForkContext: () => makeForkContext(faux.getModel()!),
				maxWorkers: 2,
			});
			const tasks = [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }];
			const result = await runSwarm(def, { tasks });
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers).toHaveLength(0);
			expect(getText(result)).toContain("exceeds the limit of 2");
		} finally {
			faux.unregister();
		}
	});

	it("prepends shared_context to every worker prompt", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ack", { stopReason: "stop" })]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [{ prompt: "the task" }],
				shared_context: "shared briefing",
				max_concurrency: 1,
			});
			const details = result.details as AgentSwarmToolDetails;
			expect(details.workers[0]!.status).toBe("ok");
			// The faux provider echoes the last user message into the request; the
			// worker still completes, proving shared_context didn't break the prompt.
			expect(details.workers[0]!.output).toBe("ack");
		} finally {
			faux.unregister();
		}
	});

	it("runs a verifier pass when verify is set", async () => {
		const faux = registerFauxProvider();
		// First response feeds the single worker, second feeds the verifier.
		faux.setResponses([
			fauxAssistantMessage("worker output", { stopReason: "stop" }),
			fauxAssistantMessage("VERIFIED: no issues found.", { stopReason: "stop" }),
		]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, { tasks: [{ prompt: "do the thing" }], verify: true, max_concurrency: 1 });
			const details = result.details as AgentSwarmToolDetails;

			expect(details.verification).toBeDefined();
			expect(details.verification!.status).toBe("ok");
			expect(details.verification!.critique).toBe("VERIFIED: no issues found.");
			expect(getText(result)).toContain("## verification [ok]");
		} finally {
			faux.unregister();
		}
	});

	it("gives workers a nested agent_swarm tool until the depth cap", () => {
		const faux = registerFauxProvider();
		try {
			const ctx = makeForkContext(faux.getModel()!);
			const options = { getForkContext: () => ctx };

			const atTop = buildWorkerToolset(ctx, options, 0).map((t) => t.name);
			expect(atTop).toContain("agent_swarm");

			const atCap = buildWorkerToolset(ctx, options, DEFAULT_SWARM_MAX_DEPTH).map((t) => t.name);
			expect(atCap).not.toContain("agent_swarm");

			const noRecursion = buildWorkerToolset(ctx, { ...options, maxDepth: 0 }, 0).map((t) => t.name);
			expect(noRecursion).not.toContain("agent_swarm");
		} finally {
			faux.unregister();
		}
	});

	it("runs consensus samples and the judge picks a winner", async () => {
		const faux = registerFauxProvider();
		// 2 samples, then the judge. Concurrency 1 keeps consumption ordered.
		faux.setResponses([
			fauxAssistantMessage("answer one", { stopReason: "stop" }),
			fauxAssistantMessage("answer two", { stopReason: "stop" }),
			fauxAssistantMessage("BEST: sample-2\nit is more complete", { stopReason: "stop" }),
		]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [{ prompt: "hard question" }],
				consensus_samples: 2,
				max_concurrency: 1,
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers.map((w) => w.id)).toEqual(["sample-1", "sample-2"]);
			expect(details.consensus).toBeDefined();
			expect(details.consensus!.chosenId).toBe("sample-2");
			expect(getText(result)).toContain("winning answer (sample-2)");
		} finally {
			faux.unregister();
		}
	});

	it("plans subtasks from a goal then runs them", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([
			fauxAssistantMessage('[{"id":"a","prompt":"do a"},{"id":"b","prompt":"do b"}]', { stopReason: "stop" }),
			fauxAssistantMessage("a done", { stopReason: "stop" }),
			fauxAssistantMessage("b done", { stopReason: "stop" }),
		]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, { goal: "do the whole thing", max_concurrency: 1 });
			const details = result.details as AgentSwarmToolDetails;

			expect(details.goal).toBe("do the whole thing");
			expect(details.workers.map((w) => w.id)).toEqual(["a", "b"]);
			expect(details.workers.every((w) => w.status === "ok")).toBe(true);
		} finally {
			faux.unregister();
		}
	});

	it("stops at quorum and aborts the rest", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("first done", { stopReason: "stop" })]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }],
				quorum: 1,
				max_concurrency: 1,
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers.filter((w) => w.status === "ok")).toHaveLength(1);
			expect(details.workers.filter((w) => w.status === "aborted")).toHaveLength(2);
		} finally {
			faux.unregister();
		}
	});

	it("retries a worker that returns nothing", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([
			fauxAssistantMessage("", { stopReason: "stop" }),
			fauxAssistantMessage("recovered", { stopReason: "stop" }),
		]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, { tasks: [{ prompt: "flaky" }], retry: 1, max_concurrency: 1 });
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers[0]!.output).toBe("recovered");
			expect(details.workers[0]!.attempts).toBe(2);
		} finally {
			faux.unregister();
		}
	});

	it("aborts remaining workers once the turn budget is spent", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("one", { stopReason: "stop" })]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }],
				max_total_turns: 1,
				max_concurrency: 1,
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers.filter((w) => w.status === "ok")).toHaveLength(1);
			expect(details.workers.filter((w) => w.status === "aborted")).toHaveLength(2);
		} finally {
			faux.unregister();
		}
	});

	it("lets a worker post to the shared blackboard", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("swarm_note", { note: "found it" }, { id: "n1" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done", { stopReason: "stop" }),
		]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [{ prompt: "investigate" }],
				blackboard: true,
				max_concurrency: 1,
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers[0]!.status).toBe("ok");
			expect(details.workers[0]!.turns).toBeGreaterThanOrEqual(1);
		} finally {
			faux.unregister();
		}
	});

	it("saves transcripts when asked", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("logged", { stopReason: "stop" })]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, { tasks: [{ prompt: "x" }], save_transcripts: true, max_concurrency: 1 });
			const details = result.details as AgentSwarmToolDetails;

			const path = details.workers[0]!.transcriptPath;
			expect(path).toBeDefined();
			expect(existsSync(path!)).toBe(true);
		} finally {
			faux.unregister();
		}
	});

	it("caps a worker at max_turns_per_agent (soft backstop)", async () => {
		const faux = registerFauxProvider();
		// A worker that keeps calling a tool would loop forever; the cap aborts it.
		// Queue far more turns than the cap to prove it stops early rather than
		// merely running out of responses. The backstop is soft, so it may finish
		// the in-flight turn (cap + 1) before stopping.
		faux.setResponses(
			Array.from({ length: 8 }, (_, i) =>
				fauxAssistantMessage([fauxToolCall("read", { path: `nope-${i}` }, { id: `r${i}` })], {
					stopReason: "toolUse",
				}),
			),
		);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [{ prompt: "loop forever" }],
				max_turns_per_agent: 2,
				max_concurrency: 1,
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers[0]!.status).toBe("aborted");
			expect(details.workers[0]!.turns).toBeGreaterThanOrEqual(2);
			expect(details.workers[0]!.turns).toBeLessThanOrEqual(3);
		} finally {
			faux.unregister();
		}
	});

	it("runs a dependent task after its dependency and injects the upstream output", async () => {
		const faux = registerFauxProvider();
		let backendMessages: Message[] | undefined;
		// frontend runs first (backend depends on it); the factory captures exactly
		// what the backend worker received so we can prove the upstream was injected.
		faux.setResponses([
			fauxAssistantMessage("FRONTEND_API_CONTRACT_v3", { stopReason: "stop" }),
			(context) => {
				backendMessages = context.messages;
				return fauxAssistantMessage("backend built against the real contract", { stopReason: "stop" });
			},
		]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [
					{ id: "frontend", prompt: "build the frontend API" },
					{ id: "backend", prompt: "build the backend", depends_on: ["frontend"] },
				],
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers.every((w) => w.status === "ok")).toBe(true);
			// The backend agent's prompt must carry the frontend's actual output.
			const backendText = JSON.stringify(backendMessages);
			expect(backendText).toContain("FRONTEND_API_CONTRACT_v3");
			expect(backendText).toContain("the agent(s) this task depends on");
			expect(backendText).toContain("frontend");
		} finally {
			faux.unregister();
		}
	});

	it("skips a dependent task when its dependency fails", async () => {
		const faux = registerFauxProvider();
		// The dependency's stream throws -> it errors; the dependent must be skipped
		// (never run, zero turns) rather than guessing against a failed upstream.
		const ctx: SwarmForkContext = {
			...makeForkContext(faux.getModel()!),
			streamFn: () => {
				throw new Error("frontend boom");
			},
		};
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => ctx });
			const result = await runSwarm(def, {
				tasks: [
					{ id: "frontend", prompt: "build the frontend API" },
					{ id: "backend", prompt: "build the backend", depends_on: ["frontend"] },
				],
				retry: 0,
			});
			const details = result.details as AgentSwarmToolDetails;
			const frontend = details.workers.find((w) => w.id === "frontend")!;
			const backend = details.workers.find((w) => w.id === "backend")!;

			expect(frontend.status).toBe("error");
			expect(backend.status).toBe("aborted");
			expect(backend.turns).toBe(0);
			expect(backend.error).toContain("skipped");
			expect(backend.error).toContain("frontend");
		} finally {
			faux.unregister();
		}
	});

	it("settles a dependency cycle instead of hanging", async () => {
		const faux = registerFauxProvider();
		// Neither task can ever become ready; the scheduler must abort both rather
		// than deadlock waiting on each other.
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			const result = await runSwarm(def, {
				tasks: [
					{ id: "a", prompt: "needs b", depends_on: ["b"] },
					{ id: "b", prompt: "needs a", depends_on: ["a"] },
				],
			});
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers).toHaveLength(2);
			expect(details.workers.every((w) => w.status === "aborted")).toBe(true);
			expect(details.workers.every((w) => (w.error ?? "").includes("cycle"))).toBe(true);
		} finally {
			faux.unregister();
		}
	});

	it("falls back gracefully when worktree isolation has no git repo", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ran in cwd", { stopReason: "stop" })]);
		try {
			const def = createAgentSwarmToolDefinition({ getForkContext: () => makeForkContext(faux.getModel()!) });
			// flameHomeTemp is not a git repo, so isolation degrades to the shared cwd.
			const result = await runSwarm(def, { tasks: [{ prompt: "x" }], isolate: "worktree", max_concurrency: 1 });
			const details = result.details as AgentSwarmToolDetails;

			expect(details.workers[0]!.status).toBe("ok");
			expect(details.workers[0]!.branch).toBeUndefined();
		} finally {
			faux.unregister();
		}
	});
});
