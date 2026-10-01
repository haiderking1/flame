import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { SessionError, type SessionLocation } from "../../contracts/sessions.js";
import type { AgentSummary, AgentTeamState } from "../../contracts/agents.js";
import type { ModelSelection } from "../../contracts/models.js";
import type { TurnStatus } from "../../contracts/turns.js";
import type { CodexAuth } from "../auth/service.js";
import type { CodexModels } from "../models/service.js";
import type { Sessions } from "../sessions/service.js";
import type { ToolCall } from "../bash/tools.js";
import type { Turns } from "../turns/service.js";
import { envelope, mailInput } from "./mail.js";
import { forkConversation } from "./fork.js";
import { nickname } from "./names.js";
import { resolvePath, ROOT_PATH, taskNameProblem } from "./paths.js";
import { TEAM_SLOTS, teamInstructions } from "./prompts.js";
import { agentResult, agentStatus, modelStatus } from "./status.js";
import { collaborationTools, listArgs, spawnArgs, targetArgs, ToolArgumentError, waitArgs } from "./tools.js";

export type Account = NonNullable<ReturnType<CodexAuth["usageSession"]>>;
/** The collaboration tools of one run, as the agent loop uses them. */
export type Collaboration = {
  tools: unknown[]; instructions: string;
  execute(call: ToolCall, signal: AbortSignal, yieldTo?: () => boolean): Promise<unknown>;
  /** Mail waiting for this agent, as conversation input; it counts as read once returned. */
  mail(): unknown[];
};
type Runner = Pick<Turns, "isRunning" | "startAgent" | "interruptAgent" | "settled" | "snapshot" | "on" | "off">;
const key = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
const SPAWN_LIMIT = "collab spawn failed: agent thread limit reached", TASK_LIMIT = "collab tool failed: agent thread limit reached";
class CollaborationError extends Error {}
const fail = (message: string): never => { throw new CollaborationError(message); };
const firstLine = (text: string) => text.split("\n").find(line => line.trim())?.trim().slice(0, 180) ?? null;

/**
 * The agents of every thread. A thread's agent (`/root`) and its subagents start agents, message them and wait for
 * them through the collaboration tools; an agent's final answer is mailed to the agent that gave it the task. Up to
 * TEAM_SLOTS agents of a thread work at once, its own agent included. Emits "change" with a thread's location whenever
 * its agents change.
 */
export class AgentTeam extends EventEmitter {
  private readonly waiters = new Map<string, Set<() => void>>();
  constructor(private readonly sessions: Sessions, private readonly runner: Runner, private readonly models: Pick<CodexModels, "state" | "validateSelection">) {
    super();
    sessions.on("agents", this.agentsChanged);
    sessions.on("removed", this.threadRemoved);
    runner.on("change", this.runChanged);
  }
  close() {
    this.sessions.off("agents", this.agentsChanged); this.sessions.off("removed", this.threadRemoved); this.runner.off("change", this.runChanged);
    for (const waiting of this.waiters.values()) for (const wake of waiting) wake();
  }
  private agentsChanged = (root: SessionLocation) => { this.emit("change", root); };
  private runChanged = (changed: string) => {
    const [projectId, sessionId] = changed.split(":") as [string, string];
    const agent = this.sessions.agent({ projectId, sessionId });
    if (agent) this.emit("change", { projectId, sessionId: agent.record.rootSessionId });
  };
  // A deleted thread takes its agents with it, once their runs have stopped.
  private threadRemoved = (thread: SessionLocation) => {
    const agents = this.sessions.agentsOf(thread);
    if (!agents.length) return;
    for (const agent of agents) if (this.runner.isRunning(agent.summary)) this.runner.interruptAgent(agent.summary);
    void Promise.all(agents.map(agent => this.runner.settled(agent.summary))).then(() => {
      for (const agent of agents) {
        try { this.sessions.removeAgent(agent.summary); }
        catch { this.sessions.warn(`Agent ${agent.record.nickname} of a deleted thread could not be removed. Its files were left untouched.`); }
      }
    });
  };
  private pathOf(location: SessionLocation) { return this.sessions.agent(location)?.record.path ?? ROOT_PATH; }
  private working(root: SessionLocation) { return this.sessions.agentsOf(root).filter(agent => this.runner.isRunning(agent.summary)).length; }
  /** The session a team member's path names, or null. */
  private find(root: SessionLocation, path: string): SessionLocation | null {
    if (path === ROOT_PATH) return root;
    return this.sessions.agentsOf(root).find(agent => agent.record.path === path)?.summary ?? null;
  }
  private notify(location: SessionLocation) { for (const wake of this.waiters.get(key(location)) ?? []) wake(); }
  private post(recipient: SessionLocation, kind: "task" | "message" | "final", sender: string, text: string) {
    this.sessions.mailbox(recipient, mailbox => mailbox.post(kind, sender, text));
    this.notify(recipient);
  }
  private start(location: SessionLocation, path: string, sender: string, task: string, settings: ModelSelection, account: Account) {
    this.runner.startAgent(location, { requestId: randomUUID(), text: envelope("task", path, sender, task), settings, account });
  }

  /** The collaboration tools of a run of `location`, the thread's own agent or a subagent. */
  forTurn(location: SessionLocation, settings: ModelSelection, account: Account): Collaboration {
    const path = this.pathOf(location);
    return {
      tools: collaborationTools(this.models.state.catalog?.models ?? []),
      instructions: teamInstructions(path, settings.effort),
      execute: async (call, signal, yieldTo) => {
        try {
          switch (call.name) {
            case "spawn_agent": return this.spawn(location, path, settings, account, call.arguments);
            case "send_message": return this.message(location, path, call.arguments);
            case "followup_task": return this.followUp(location, path, account, call.arguments);
            case "wait_agent": return await this.wait(location, call.arguments, signal, yieldTo);
            case "interrupt_agent": return await this.interrupt(location, path, call.arguments);
            case "list_agents": return this.list(location, call.arguments);
            default: return { error: `Unknown collaboration tool \`${call.name}\`.` };
          }
        } catch (error) {
          if (error instanceof ToolArgumentError || error instanceof CollaborationError || error instanceof SessionError) return { error: error.message };
          if (signal.aborted) throw error;
          return { error: "The collaboration tool failed. Check the team with list_agents before trying again." };
        }
      },
      mail: () => {
        const pending = this.sessions.mailbox(location, mailbox => mailbox.pending());
        if (!pending.length) return [];
        this.sessions.mailbox(location, mailbox => mailbox.delivered(pending.map(mail => mail.id)));
        return mailInput(path, pending);
      },
    };
  }
  private spawn(caller: SessionLocation, callerPath: string, settings: ModelSelection, account: Account, raw: string) {
    const args = spawnArgs(raw);
    const problem = taskNameProblem(args.taskName);
    if (problem) fail(problem);
    const root = this.sessions.rootOf(caller), path = `${callerPath}/${args.taskName}`, team = this.sessions.agentsOf(root);
    if (team.some(agent => agent.record.path === path)) fail(`agent path \`${path}\` already exists`);
    if (this.working(root) >= TEAM_SLOTS - 1) fail(SPAWN_LIMIT);
    const agentSettings = this.settingsFor(settings, account, args.model, args.effort);
    const fork = forkConversation(this.sessions.turns(caller, store => store.context(settings, account.key)), args.forkTurns);
    const location = { projectId: caller.projectId, sessionId: randomUUID() };
    this.sessions.createAgent(location, agentSettings, { rootSessionId: root.sessionId, parentSessionId: caller.sessionId, path,
      nickname: nickname(new Set(team.map(agent => agent.record.nickname))), task: args.message, createdAt: Date.now() }, fork);
    this.start(location, path, callerPath, args.message, agentSettings, account);
    return { task_name: path };
  }
  /** The parent's model and effort, or the ones the model asked for when the catalog has them. */
  private settingsFor(parent: ModelSelection, account: Account, modelId?: string, effort?: string): ModelSelection {
    if (!modelId && !effort) return parent;
    const catalog = this.models.state.catalog?.models ?? [];
    const model = catalog.find(item => item.id === (modelId ?? parent.modelId));
    if (!model) return fail(`Unknown model \`${modelId ?? parent.modelId}\` for spawn_agent. Available models: ${catalog.map(item => item.id).join(", ") || "none"}`);
    const levels = model.reasoningLevels.map(level => level.effort);
    if (effort && !levels.includes(effort)) fail(`Reasoning effort \`${effort}\` is not supported for model \`${model.id}\`. Supported reasoning efforts: ${levels.join(", ") || "none"}`);
    const chosen = effort ?? (parent.effort && levels.includes(parent.effort) ? parent.effort : model.defaultReasoning);
    return this.models.validateSelection(account.key, { modelId: model.id, effort: chosen, serviceTier: model.supportsFast ? parent.serviceTier : "default" });
  }
  private member(caller: SessionLocation, callerPath: string, target: string) {
    const path = resolvePath(callerPath, target), location = this.find(this.sessions.rootOf(caller), path);
    return location ? { path, location } : fail(`live agent path \`${path}\` not found`);
  }
  private message(caller: SessionLocation, callerPath: string, raw: string) {
    const { target, message } = targetArgs(raw, true) as { target: string; message: string };
    const { location } = this.member(caller, callerPath, target);
    this.post(location, "message", callerPath, message);
    return "";
  }
  private followUp(caller: SessionLocation, callerPath: string, account: Account, raw: string) {
    const { target, message } = targetArgs(raw, true) as { target: string; message: string };
    const { path, location } = this.member(caller, callerPath, target);
    if (path === ROOT_PATH) fail("Follow-up tasks can't target the root agent");
    if (this.runner.isRunning(location)) { this.post(location, "task", callerPath, message); return ""; }
    if (this.working(this.sessions.rootOf(caller)) >= TEAM_SLOTS - 1) fail(TASK_LIMIT);
    const settings = this.sessions.read(location).settings;
    if (!settings) fail(`live agent path \`${path}\` has no model`);
    this.start(location, path, callerPath, message, settings!, account);
    return "";
  }
  private wait(caller: SessionLocation, raw: string, signal: AbortSignal, yieldTo?: () => boolean) {
    const args = waitArgs(raw);
    const note = args.clamped ? `\n\nRequested timeout of ${args.requested}ms was clamped to the minimum of ${args.timeoutMs}ms.` : "";
    const outcome = (message: string, timedOut: boolean) => ({ message: `${message}${note}`, timed_out: timedOut });
    if (this.sessions.mailbox(caller, mailbox => mailbox.pendingCount()) > 0) return Promise.resolve(outcome("Wait completed.", false));
    return new Promise<ReturnType<typeof outcome>>((resolve, reject) => {
      const waiting = this.waiters.get(key(caller)) ?? new Set<() => void>();
      this.waiters.set(key(caller), waiting);
      const done = (result: ReturnType<typeof outcome> | Error) => {
        clearTimeout(timer); clearInterval(poll); signal.removeEventListener("abort", abort);
        waiting.delete(wake); if (!waiting.size) this.waiters.delete(key(caller));
        if (result instanceof Error) reject(result); else resolve(result);
      };
      const wake = () => done(outcome("Wait completed.", false));
      const abort = () => done(new Error("Wait cancelled"));
      const timer = setTimeout(() => done(outcome("Wait timed out.", true)), args.timeoutMs);
      // A message the user sends meanwhile takes over, as it does at any tool step.
      const poll = setInterval(() => { if (yieldTo?.()) done(outcome("Wait interrupted by new input.", false)); }, 250);
      waiting.add(wake);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  // Returns once the run has stopped, so its slot is free for the next task.
  private async interrupt(caller: SessionLocation, callerPath: string, raw: string) {
    const { target } = targetArgs(raw, false);
    const path = resolvePath(callerPath, target);
    if (path === ROOT_PATH) fail("root is not a spawned agent");
    if (path === callerPath) fail("an agent cannot interrupt itself; return your result and let the parent interrupt you if needed");
    const { location } = this.member(caller, callerPath, target);
    const latest = this.runner.snapshot(location), previous = agentStatus(latest);
    if (previous === "running") { this.runner.interruptAgent(location); await this.runner.settled(location); }
    return { previous_status: modelStatus(previous, agentResult(latest)) };
  }
  private list(caller: SessionLocation, raw: string) {
    const { prefix } = listArgs(raw);
    const root = this.sessions.rootOf(caller);
    const members = [{ path: ROOT_PATH, location: root }, ...this.sessions.agentsOf(root).map(agent => ({ path: agent.record.path, location: agent.summary as SessionLocation }))]
      .filter(member => !prefix || member.path === prefix || member.path.startsWith(`${prefix}/`));
    return { agents: members.map(member => {
      const latest = this.runner.snapshot(member.location);
      return { agent_name: member.path, agent_status: modelStatus(agentStatus(latest), agentResult(latest)) };
    }) };
  }

  /** An agent's run ended: its final answer, or why it failed, goes to the agent that gave it its task. */
  finished(location: SessionLocation, status: Exclude<TurnStatus, "running">, answer: string, message: string | null) {
    const agent = this.sessions.agent(location);
    if (!agent) return;
    const parent = { projectId: location.projectId, sessionId: agent.record.parentSessionId };
    try {
      if (status === "completed") this.post(parent, "final", agent.record.path, answer || "(The agent finished without a final message.)");
      else if (status === "failed") this.post(parent, "final", agent.record.path,
        `Agent errored: ${message ?? "its run failed"}\n\nThis agent's run failed. If you still need this agent, give it another task with the collaboration tools.`);
    } catch { this.sessions.warn(`Agent ${agent.record.nickname}'s result could not be delivered to the agent that started it.`); }
    this.emit("change", this.sessions.rootOf(location));
  }
  /** Stops every running agent of a thread. */
  stop(thread: SessionLocation) {
    for (const agent of this.sessions.agentsOf(thread)) if (this.runner.isRunning(agent.summary)) this.runner.interruptAgent(agent.summary);
  }
  /** A thread's agents, oldest first, for the Agents panel. */
  summaries(thread: SessionLocation): AgentSummary[] {
    return this.sessions.agentsOf(thread).sort((a, b) => a.record.createdAt - b.record.createdAt).flatMap(agent => {
      try {
        const location = agent.summary, latest = this.runner.snapshot(location), document = this.sessions.read(location);
        const step = latest?.activity?.steps.at(-1);
        const activity = !step ? null : step.kind === "message" ? firstLine(step.text) : step.file?.summary ?? firstLine(step.command);
        return [{ projectId: location.projectId, sessionId: location.sessionId, ...agent.record,
          status: agentStatus(latest), settings: document.settings, result: agentResult(latest),
          startedAt: latest?.activity?.startedAt ?? (latest ? agent.record.createdAt : null), finishedAt: latest && latest.status !== "running" ? latest.activity?.finishedAt ?? document.updatedAt : null,
          runs: this.sessions.turns(location, store => store.runs()), tokens: document.context?.estimatedTokens ?? null, activity }];
      } catch { return []; }
    });
  }
  /** Every thread with agents working. */
  teams(): AgentTeamState[] {
    const working = new Map<string, AgentTeamState>();
    for (const agent of this.sessions.allAgents()) {
      if (!this.runner.isRunning(agent.summary)) continue;
      const thread = { projectId: agent.summary.projectId, sessionId: agent.record.rootSessionId };
      const current = working.get(key(thread));
      working.set(key(thread), { ...thread, working: (current?.working ?? 0) + 1 });
    }
    return [...working.values()];
  }
}
