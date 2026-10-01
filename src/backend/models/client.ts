import { ModelsError, type ModelCatalog } from "../../contracts/models.js";
import type { ApiSession } from "../auth/service.js";
import { modelsRoute } from "../openai/routes.js";
import { parseModels } from "./payload.js";

export type ModelsSession = Omit<ApiSession, "method"> & Partial<Pick<ApiSession, "method">>;
export { CATALOG_VERSION, CODEX_CATALOG_URL as CATALOG_URL } from "../openai/routes.js";
const MAX_BYTES = 4 * 1024 * 1024;

export class CodexModelsClient {
  constructor(private readonly request: typeof fetch = fetch) {}
  async read(session: ModelsSession, previous: ModelCatalog | null, signal: AbortSignal): Promise<ModelCatalog> {
    try {
      const route = modelsRoute(session);
      const response = await this.request(route.url, {
        method: "GET", redirect: "error", cache: "no-store",
        headers: { ...route.headers, Accept: "application/json", ...(previous?.etag ? { "If-None-Match": previous.etag } : {}) },
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
