import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Schema } from "effect";
import { Project } from "../../contracts/projects.js";

const decodeProjects = Schema.decodeUnknownSync(Schema.Array(Project));

export class ProjectStore {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (typeof version !== "number" || version > 1) throw new Error("Unsupported project database version");
      if (version === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE projects (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            path TEXT UNIQUE NOT NULL,
            created_at INTEGER NOT NULL
          ) STRICT;
          PRAGMA user_version = 1;
          COMMIT;`);
      }
    } catch (error) { this.db.close(); throw error; }
  }
  list(): ReadonlyArray<Project> {
    return decodeProjects(this.db.prepare("SELECT id, name, path, created_at AS createdAt FROM projects ORDER BY created_at, id").all());
  }
  add(path: string): Project {
    this.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO NOTHING")
      .run(randomUUID(), basename(path) || path, path, Date.now());
    return Schema.decodeUnknownSync(Project)(this.db.prepare("SELECT id, name, path, created_at AS createdAt FROM projects WHERE path = ?").get(path));
  }
  close() { this.db.close(); }
}
