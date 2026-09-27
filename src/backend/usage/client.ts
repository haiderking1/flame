import { UsageError, type ResetOutcome } from "../../contracts/usage.js";
import { parseCredits, parseOutcome, parseUsage, type UsageData } from "./payloads.js";

export type UsageSession = { key: string; accountId: string; access: string; epoch: number };
const ROOT = "https://chatgpt.com/backend-api/wham";

export class CodexUsageClient {
  constructor(private readonly request: typeof fetch = fetch) {}
  private async json(path: string, session: UsageSession, signal: AbortSignal, body?: object): Promise<unknown> {
    try {
      const response = await this.request(`${ROOT}/${path}`, {
        method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${session.access}`, "ChatGPT-Account-Id": session.accountId,
          Accept: "application/json", "User-Agent": "Flame", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new UsageError({ message: response.status === 401 || response.status === 403
          ? "OpenAI could not authorize usage access. Check your sign-in in Providers."
          : `Could not fetch Codex usage (HTTP ${response.status}). Try again later.` });
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 1024 * 1024) { await reader.cancel(); throw new Error("Oversized response"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof UsageError) throw error;
      throw new UsageError({ message: "Could not read Codex usage. Check your connection and try again." });
    }
  }
  async read(session: UsageSession, signal: AbortSignal): Promise<UsageData> {
    const snapshot = parseUsage(await this.json("usage", session, signal), Date.now());
    // Detailed credit IDs are fetched separately when confirming intent, not on background reads.
    return { snapshot, credits: [] };
  }
  async credits(session: UsageSession, signal: AbortSignal) {
    return parseCredits(await this.json("rate-limit-reset-credits", session, signal), Date.now());
  }
  async consume(session: UsageSession, creditId: string, requestId: string, signal: AbortSignal): Promise<ResetOutcome> {
    // Exactly one attempt. Even an HTTP error can have an ambiguous side-effect outcome.
    try {
      return parseOutcome(await this.json("rate-limit-reset-credits/consume", session, signal,
        { credit_id: creditId, redeem_request_id: requestId }));
    } catch { return "unknown"; }
  }
}
