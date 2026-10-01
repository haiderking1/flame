import { randomUUID } from "node:crypto";
import { GitError } from "../../../contracts/git.js";
import type { ModelSelection } from "../../../contracts/models.js";
import type { CodexAuth } from "../../auth/service.js";
import type { CodexModels } from "../../models/service.js";
import type { CodexInferenceClient } from "../../turns/client.js";
import { InferenceFailure } from "../../turns/sse.js";
import { sanitizeFeatureBranchName } from "../branch-names.js";
import { WRITER_INSTRUCTIONS } from "./prompts.js";
import { TITLE_INSTRUCTIONS } from "../../titles/prompts.js";

const GENERATION_TIMEOUT_MS = 180_000;
export type CommitText = { subject: string; body: string; branch: string | null };
export type ChangeRequestText = { title: string; body: string };
/** Names a session's worktree branch from its first message. */
export interface BranchNamer {
  branch(prompt: string, images: readonly unknown[], signal: AbortSignal): Promise<string>;
}
/** Titles a thread with the text model; `prompt` is a full thread title prompt. */
export interface TitleWriter {
  title(prompt: string, model: ModelSelection | null, images: readonly unknown[], signal: AbortSignal): Promise<{ title: string; needsRefinement: boolean }>;
}
export interface GitWriter {
  commit(prompt: string, model: ModelSelection | null, includeBranch: boolean, signal: AbortSignal): Promise<CommitText>;
  changeRequest(prompt: string, model: ModelSelection | null, signal: AbortSignal): Promise<ChangeRequestText>;
}
/** Extracts the JSON object from a reply, tolerating code fences or stray prose around it. */
export function parseReply(text: string): Record<string, unknown> {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { const value: unknown = JSON.parse(text.slice(start, end + 1)); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; }
    catch { /* Reported below. */ }
  }
  throw new GitError({ code: "COMMAND", message: "The model returned text Flame could not read as a commit message. Write a message yourself or retry." });
}
const field = (reply: Record<string, unknown>, key: string) => typeof reply[key] === "string" ? (reply[key] as string).trim() : "";
/** First line, without trailing periods, at most 72 characters. */
export function commitSubject(text: string, fallback = "Update project files") {
  const first = text.trim().split(/\r?\n/, 1)[0]!.trim().replace(/\.+$/, "").trim().slice(0, 72).trim();
  return first || fallback;
}
export function commitText(reply: Record<string, unknown>, includeBranch: boolean): CommitText {
  const subject = commitSubject(field(reply, "subject"));
  const branch = includeBranch ? sanitizeFeatureBranchName(field(reply, "branch") || subject) : null;
  return { subject, body: field(reply, "body"), branch };
}
export function changeRequestText(reply: Record<string, unknown>): ChangeRequestText {
  return { title: commitSubject(field(reply, "title"), "Update project changes").slice(0, 256), body: field(reply, "body") };
}
/** Writes commit messages, change request text, branch names and thread titles with the text model from Settings, else the chat model. */
export class CodexGitWriter implements GitWriter, BranchNamer, TitleWriter {
  constructor(private readonly auth: Pick<CodexAuth, "usageSession" | "refresh">, private readonly models: Pick<CodexModels, "validateSelection" | "state"> & Partial<Pick<CodexModels, "supportsImages">>,
    private readonly client: Pick<CodexInferenceClient, "run">) {}
  async commit(prompt: string, model: ModelSelection | null, includeBranch: boolean, signal: AbortSignal) {
    return commitText(parseReply(await this.generate(prompt, model, signal)), includeBranch);
  }
  async changeRequest(prompt: string, model: ModelSelection | null, signal: AbortSignal) {
    return changeRequestText(parseReply(await this.generate(prompt, model, signal)));
  }
  /** A branch name suggestion, raw; the caller normalizes it. Images go along only when the Git text model reads them. */
  async branch(prompt: string, images: readonly unknown[], signal: AbortSignal) {
    const name = field(parseReply(await this.generate(prompt, null, signal, images)), "branch");
    if (!name) throw new GitError({ code: "COMMAND", message: "The model did not suggest a branch name." });
    return name;
  }
  /** A thread title, raw; the caller cleans it up. Images go along only when the text model reads them. */
  async title(prompt: string, model: ModelSelection | null, images: readonly unknown[], signal: AbortSignal) {
    const reply = parseReply(await this.generate(prompt, model, signal, images, TITLE_INSTRUCTIONS));
    if (typeof reply.title !== "string") throw new GitError({ code: "COMMAND", message: "The model did not suggest a title." });
    return { title: reply.title, needsRefinement: reply.needsRefinement === true };
  }
  private async generate(prompt: string, model: ModelSelection | null, signal: AbortSignal, images: readonly unknown[] = [], instructions = WRITER_INSTRUCTIONS) {
    if (!this.auth.usageSession()) await this.auth.refresh().catch(() => {});
    const account = this.auth.usageSession();
    if (!account) throw new GitError({ code: "INVALID", message: "Sign in to OpenAI in Providers to generate text, or write the commit message yourself." });
    const settings = this.settings(account.key, model);
    const withImages = images.length && this.models.supportsImages?.(account.key, settings.modelId) !== false ? images : [];
    const id = randomUUID();
    try {
      const result = await this.client.run({ accountId: account.accountId, access: account.access, sessionId: id, promptCacheKey: id,
        settings, tools: false, fileTools: false, bashTools: false,
        instructionsOverride: instructions, input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...withImages] }] }, () => {},
        AbortSignal.any([signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]));
      return result.text;
    } catch (error) {
      if (signal.aborted) throw new GitError({ code: "UNAVAILABLE", message: "Text generation was interrupted." });
      if (error instanceof InferenceFailure) throw new GitError({ code: "COMMAND", message: `Text generation failed: ${error.message}` });
      throw new GitError({ code: "COMMAND", message: "Text generation failed. Write the commit message yourself or retry." });
    }
  }
  /**
   * The Git text model from Settings, used exactly as configured. Without one, or when the catalog dropped it, the chat
   * model writes the text at its default thinking level and standard tier, so Git text never spends priority quota unasked.
   */
  private settings(accountKey: string, model: ModelSelection | null): ModelSelection {
    const configured = this.models.state.gitText;
    if (configured) {
      try { return this.models.validateSelection(accountKey, configured); }
      catch { /* Fall back to the chat model below. */ }
    }
    // Without an explicit or default selection, any available model can write a commit message.
    const fallback = this.models.state.catalog?.models[0];
    const chosen = model ?? this.models.state.selection ?? (fallback ? { modelId: fallback.id, effort: null, serviceTier: "default" as const } : null);
    if (!chosen) throw new GitError({ code: "INVALID", message: "Choose a model to generate text, or write the commit message yourself." });
    try { return { ...this.models.validateSelection(accountKey, chosen), effort: null, serviceTier: "default" }; }
    catch { throw new GitError({ code: "INVALID", message: "The selected model is no longer available. Choose another model or write the commit message yourself." }); }
  }
}
