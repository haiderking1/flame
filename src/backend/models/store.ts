import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { ModelCatalog, ModelSelection } from "../../contracts/models.js";
import { CATALOG_URL } from "./client.js";

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
      ) STRICT;`);
  }
  load(account: string): ModelCatalog | null {
    const row = this.db.prepare("SELECT catalog FROM codex_models_cache WHERE account = ? AND endpoint = ?").get(account, CATALOG_URL);
    if (!row) return null;
    try {
      const catalog = Schema.decodeUnknownSync(ModelCatalog)(JSON.parse(String(row.catalog)));
      if (!Number.isFinite(catalog.fetchedAt) || catalog.models.length > 1000 || (catalog.etag?.length ?? 0) > 1024) return null;
      return catalog;
    } catch { return null; }
  }
  save(account: string, catalog: ModelCatalog) {
    this.db.prepare("INSERT INTO codex_models_cache VALUES (?, ?, ?) ON CONFLICT(account, endpoint) DO UPDATE SET catalog=excluded.catalog")
      .run(account, CATALOG_URL, JSON.stringify(catalog));
  }
  loadSelection(account: string): ModelSelection | null {
    const row = this.db.prepare("SELECT selection FROM codex_model_selection WHERE account = ?").get(account);
    if (!row) return null;
    try {
      const saved = JSON.parse(String(row.selection));
      return Schema.decodeUnknownSync(ModelSelection)({ serviceTier: "default", ...saved });
    }
    catch { return null; }
  }
  saveSelection(account: string, selection: ModelSelection) {
    this.db.prepare("INSERT INTO codex_model_selection VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET selection=excluded.selection")
      .run(account, JSON.stringify(selection));
  }
  close() { this.db.close(); }
}
