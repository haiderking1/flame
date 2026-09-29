import type { ContextInfo } from "../../contracts/compaction.js";
import type { CodexInferenceClient, InferenceRequest, InferenceResult } from "../turns/client.js";
import { InferenceFailure } from "../turns/sse.js";
import { ContextOverflow } from "../turns/provider-errors.js";
import { fitsInputBudget } from "../turns/input-budget.js";
import { estimateTokens } from "./estimate.js";
import { planCompaction } from "./plan.js";
import { generateSummary } from "./summary.js";
import { summaryInput } from "../sessions/context-items.js";

type Trigger = "auto" | "manual" | "overflow";
export type CompactionCallbacks = {
  save(summary: string, kept: unknown[], tokensBefore: number, tokensAfter: number, trigger: Trigger): void;
  phase(phase: "responding" | "compacting", context: ContextInfo): void;
  ledger(): unknown[];
};

export class CompactionRuntime {
  input: unknown[];
  private anchor?: { tokens: number; count: number; ledgerTokens: number };
  private count: number;
  private lastCompactedAt: number | null;
  private recoveredOverflow = false;
  constructor(private client: Pick<CodexInferenceClient, "run">, private request: InferenceRequest,
    input: readonly unknown[], private window: number, private overhead: number,
    private callbacks: CompactionCallbacks, private signal: AbortSignal, count = 0, lastCompactedAt: number | null = null) {
    this.input = [...input]; this.count = count; this.lastCompactedAt = lastCompactedAt;
  }
  info(): ContextInfo {
    const ledger = estimateTokens(this.callbacks.ledger());
    const estimate = this.anchor ? this.anchor.tokens + estimateTokens(this.input.slice(this.anchor.count))
      + Math.max(0, ledger - this.anchor.ledgerTokens) : estimateTokens(this.input) + this.overhead + ledger;
    return { estimatedTokens: estimate, contextWindow: this.window, thresholdTokens: Math.floor(this.window * 0.9),
      compactionCount: this.count, lastCompactedAt: this.lastCompactedAt };
  }
  append(items: readonly unknown[]) { this.input.push(...items); }
  restoreAnchor(anchor: { tokens: number; count: number; ledgerTokens?: number; overhead?: number }) {
    this.anchor = { ...anchor, ledgerTokens: anchor.ledgerTokens ?? 0 };
    this.overhead = anchor.overhead ?? 0;
  }
  setOverhead(tokens: number) {
    if (this.anchor) this.anchor.tokens += Math.max(0, tokens - this.overhead);
    this.overhead = tokens;
  }
  overheadTokens() { return this.overhead; }
  publish() { this.callbacks.phase("responding", this.info()); }
  completed(response: InferenceResult) {
    this.append(response.output);
    if (response.usage) this.anchor = { tokens: response.usage.totalTokens, count: this.input.length, ledgerTokens: estimateTokens(this.callbacks.ledger()) };
  }
  async compact(trigger: Trigger): Promise<boolean> {
    this.signal.throwIfAborted();
    const before = this.info();
    const plan = planCompaction(this.input, { contextWindow: this.window, force: true });
    if (!plan) {
      if (trigger === "manual") throw new InferenceFailure("There is not enough earlier conversation to compact. Your recent messages were kept.");
      return false;
    }
    this.callbacks.phase("compacting", before);
    const summary = await generateSummary(this.client, this.request, plan.prefix, this.window, this.signal);
    const next = [summaryInput(summary), ...plan.kept];
    const after = estimateTokens(next) + this.overhead + estimateTokens(this.callbacks.ledger());
    if (after >= before.estimatedTokens || after >= before.thresholdTokens || !fitsInputBudget(next)) {
      throw new InferenceFailure("Compaction could not free enough context. Your history was preserved; no operations were replayed.");
    }
    this.signal.throwIfAborted();
    this.callbacks.save(summary, plan.kept, before.estimatedTokens, after, trigger);
    this.input = next; this.anchor = undefined; this.count++; this.lastCompactedAt = Date.now();
    this.callbacks.phase("responding", this.info());
    return true;
  }
  async prepare() {
    const input = [...this.input, ...this.callbacks.ledger()];
    if (this.info().estimatedTokens >= Math.floor(this.window * 0.9) || !fitsInputBudget(input)) {
      if (!await this.compact("auto")) throw new InferenceFailure("The latest message or tool exchange is too large to compact safely. Its history was preserved.");
    }
    this.callbacks.phase("responding", this.info());
    // Keep the latest human request last when beginning a response. Fresh
    // ledgers describe operations; they must not look like a newer request.
    const latest = this.input.at(-1);
    const ledger = this.callbacks.ledger();
    return latest && typeof latest === "object" && "role" in latest && latest.role === "user"
      ? [...this.input.slice(0, -1), ...ledger, latest] : [...this.input, ...ledger];
  }
  async run(request: InferenceRequest, onText: (text: string) => void): Promise<InferenceResult> {
    for (;;) {
      const input = await this.prepare();
      try { return await this.client.run({ ...request, input }, onText, this.signal); }
      catch (error) {
        if (!(error instanceof ContextOverflow) || this.recoveredOverflow) throw error;
        this.recoveredOverflow = true;
        if (!await this.compact("overflow")) throw new InferenceFailure("OpenAI's context window is full and there is no earlier history to compact. No operations were replayed.");
      }
    }
  }
}
