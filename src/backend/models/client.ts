import { ModelsError, type ModelCatalog } from "../../contracts/models.js";
import type { CodexAuth } from "../auth/service.js";
import { parseModels } from "./payload.js";

export type ModelsSession = NonNullable<ReturnType<CodexAuth["usageSession"]>>;
// Catalog protocol compatibility, not Flame's application version. Never used to pin model IDs.
export const CATALOG_VERSION = "0.159.0";
export const CATALOG_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CATALOG_VERSION}`;
const MAX_BYTES = 4 * 1024 * 1024;

export class CodexModelsClient {
  constructor(private readonly request: typeof fetch = fetch) {}
  async read(session: ModelsSession, previous: ModelCatalog | null, signal: AbortSignal): Promise<ModelCatalog> {
    try {
      const response = await this.request(CATALOG_URL, {
        method: "GET", redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${session.access}`, "ChatGPT-Account-Id": session.accountId,
          Accept: "application/json", "User-Agent": "Flame", originator: "flame",
          ...(previous?.etag ? { "If-None-Match": previous.etag } : {}) },
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      if (response.status === 304 && previous) return { ...previous, fetchedAt: Date.now() };
      if (!response.ok) {
        await response.body?.cancel();
        throw new ModelsError({ message: response.status === 401 || response.status === 403
          ? "OpenAI could not authorize model access. Check your sign-in in Providers."
          : `Could not fetch OpenAI models (HTTP ${response.status}). Try again later.` });
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Oversized response"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const models = parseModels(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const etag = response.headers.get("etag");
      return { fetchedAt: Date.now(), etag: etag && etag.length <= 1024 ? etag : null, models };
    } catch (error) {
      if (error instanceof ModelsError) throw error;
      throw new ModelsError({ message: "Could not read OpenAI models. Check your connection and try again." });
    }
  }
}
