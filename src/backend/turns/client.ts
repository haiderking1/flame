import type { ModelSelection } from "../../contracts/models.js";
import { events, InferenceFailure } from "./sse.js";
export { InferenceFailure } from "./sse.js";
export type InferenceRequest = { accountId: string; access: string; sessionId: string; settings: ModelSelection; input: unknown[] };
import { object, ResponseOutput, type InferenceResult } from "./output.js";
export type { InferenceResult } from "./output.js";
const failure = (message: string): never => { throw new InferenceFailure(message); };

export class CodexInferenceClient {
  constructor(private fetcher: typeof fetch = fetch) {}
  async run(request: InferenceRequest, onText: (delta: string) => void, signal: AbortSignal): Promise<InferenceResult> {
    const timeout = AbortSignal.timeout(10 * 60_000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      if (Buffer.byteLength(JSON.stringify(request.input)) > 8 * 1024 * 1024) return failure("This conversation exceeds the input limit. Start a new session.");
      const body = { model: request.settings.modelId, store: false, stream: true,
        instructions: "You are Flame, a coding assistant. Answer the user's request accurately. You do not currently have tools or access to their files, terminal, or project contents. Never claim you inspected or changed files or ran commands.",
        input: request.input, include: ["reasoning.encrypted_content"], prompt_cache_key: request.sessionId,
        ...(request.settings.effort !== null ? { reasoning: { effort: request.settings.effort, summary: "auto" } } : {}),
        ...(request.settings.serviceTier === "priority" ? { service_tier: "priority" } : {}),
      };
      const response = await this.fetcher("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST", signal: combined, redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${request.access}`, "ChatGPT-Account-Id": request.accountId,
          "Content-Type": "application/json", Accept: "text/event-stream", "OpenAI-Beta": "responses=experimental", originator: "flame", "User-Agent": "Flame", "session-id": request.sessionId },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return failure(response.status === 401 || response.status === 403 ? "OpenAI could not authorize this response. Check your sign-in in Providers."
          : response.status === 429 ? "OpenAI rate-limited this response. Check Usage before trying again. No banked reset was used."
          : `OpenAI could not generate a response (HTTP ${response.status}). The request was not replayed.`);
      }
      // Codex clients validate SSE frames, not the Content-Type header. Gateways
      // can omit or replace that header even when the body is a valid event stream.
      if (!response.body) return failure(`OpenAI returned no response body (HTTP ${response.status}). The request was not replayed.`);
      let size = 0, streamedText = "";
      const output = new ResponseOutput();
      let previousItem: unknown;
      for await (const data of events(response.body, combined)) {
        if (data === "[DONE]") break;
        const event = object(JSON.parse(data));
        if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
          if (typeof event.delta !== "string") return failure("OpenAI returned an invalid text event.");
          const item = event.item_id ?? event.output_index;
          if (previousItem !== undefined && item !== undefined && item !== previousItem) { onText("\n\n"); streamedText += "\n\n"; size += 2; }
          previousItem = item;
          size += Buffer.byteLength(event.delta);
          if (size > 1024 * 1024) return failure("The response exceeded Flame's 1 MiB response limit.");
          streamedText += event.delta;
          onText(event.delta);
        } else if (event.type === "response.output_item.done") output.record(event.output_index, event.item);
        else if (event.type === "response.completed" || event.type === "response.done") return output.complete(event.response, streamedText);
        else if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
          return failure("OpenAI did not complete this response. The request was not replayed.");
        }
      }
      return failure("The connection ended before OpenAI confirmed completion. The request was not replayed.");
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof InferenceFailure) throw error;
      return failure(timeout.aborted ? "The response timed out. The request was not replayed." : "Could not complete the OpenAI response. Check your connection. The request was not replayed.");
    }
  }
}
