import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { ModelCatalog, ModelSelection } from "../../contracts/models.js";
import { CODEX_CATALOG_URL } from "../openai/routes.js";

export class ModelsStore {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS codex_models_cache (
        account TEXT NOT NULL, endpoint TEXT NOT NULL, catalog TEXT NOT NULL,
        PRIMARY KEY(account, endpoint)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS codex_model_selection (
        account TEXT PRIMARY KEY, selection TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS codex_git_text_model (
        account TEXT PRIMARY KEY, selection TEXT NOT NULL
      ) STRICT;`);
  }
  /** The catalog last read from `endpoint` for the account. */
  load(account: string, endpoint = CODEX_CATALOG_URL): ModelCatalog | null {
    const row = this.db.prepare("SELECT catalog FROM codex_models_cache WHERE account = ? AND endpoint = ?").get(account, endpoint);
    if (!row) return null;
    try {
      const catalog = Schema.decodeUnknownSync(ModelCatalog)(JSON.parse(String(row.catalog)));
      if (!Number.isFinite(catalog.fetchedAt) || catalog.models.length > 1000 || (catalog.etag?.length ?? 0) > 1024) return null;
      return catalog;
    } catch { return null; }
  }
  save(account: string, catalog: ModelCatalog, endpoint = CODEX_CATALOG_URL) {
    this.db.prepare("INSERT INTO codex_models_cache VALUES (?, ?, ?) ON CONFLICT(account, endpoint) DO UPDATE SET catalog=excluded.catalog")
      .run(account, endpoint, JSON.stringify(catalog));
  }
  loadSelection(account: string): ModelSelection | null {
    return this.readSelection("codex_model_selection", account);
  }
  saveSelection(account: string, selection: ModelSelection) {
    this.db.prepare("INSERT INTO codex_model_selection VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET selection=excluded.selection")
      .run(account, JSON.stringify(selection));
  }
  /** The account's dedicated Git text model; null when Git text follows the chat model. */
  loadGitText(account: string): ModelSelection | null {
    return this.readSelection("codex_git_text_model", account);
  }
  saveGitText(account: string, selection: ModelSelection | null) {
    if (!selection) { this.db.prepare("DELETE FROM codex_git_text_model WHERE account = ?").run(account); return; }
    this.db.prepare("INSERT INTO codex_git_text_model VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET selection=excluded.selection")
      .run(account, JSON.stringify(selection));
  }
  private readSelection(table: "codex_model_selection" | "codex_git_text_model", account: string): ModelSelection | null {
    const row = this.db.prepare(`SELECT selection FROM ${table} WHERE account = ?`).get(account);
    if (!row) return null;
    try {
      const saved = JSON.parse(String(row.selection));
      return Schema.decodeUnknownSync(ModelSelection)({ serviceTier: "default", ...saved });
    }
    catch { return null; }
  }
  close() { this.db.close(); }
}
