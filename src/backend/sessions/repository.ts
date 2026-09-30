import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type SessionDocument, type SessionLocation, type SessionSummary } from "../../contracts/sessions.js";
import type { ModelSelection } from "../../contracts/models.js";
import type { ProjectStore } from "../projects/store.js";
import { SessionDatabase } from "./database.js";
import { checkId, directory, isMissing, missing, projectDirectory, sessionDirectory, storageError, syncDirectory, validId } from "./files.js";

export function summary({ projectId, sessionId, title, createdAt, updatedAt, revision, settledAt }: SessionDocument): SessionSummary {
  return { projectId, sessionId, title, createdAt, updatedAt, revision, settledAt };
}
export class SessionRepository {
  constructor(private readonly root: string, private readonly projects: Pick<ProjectStore, "list">) {}
  private project(location: SessionLocation) {
    checkId(location.projectId); checkId(location.sessionId);
    if (!this.projects.list().some((project) => project.id === location.projectId)) throw missing();
  }
  assertUploadTarget(location: SessionLocation) {
    this.project(location);
    const parent = join(this.root, location.projectId, "sessions");
    if (existsSync(parent)) {
      projectDirectory(this.root, location.projectId, false);
      const trash = join(parent, ".trash");
      if (existsSync(trash)) {
        directory(trash);
        if (existsSync(join(trash, location.sessionId))) throw missing();
      }
      if (existsSync(join(parent, location.sessionId))) this.use(location, db => db.read());
    }
  }
  use<T>(location: SessionLocation, work: (db: SessionDatabase) => T): T {
    this.project(location);
    let db;
    try {
      const path = sessionDirectory(this.root, location);
      db = new SessionDatabase(join(path, "session.sqlite"), location);
      return work(db);
    } catch (error) { if (isMissing(error)) throw missing(); throw error; }
    finally { db?.close(); }
  }
  create(location: SessionLocation, settings: ModelSelection | null) {
    this.project(location);
    const parent = projectDirectory(this.root, location.projectId, true);
    const target = join(parent, location.sessionId);
    if (existsSync(join(parent, ".trash"))) {
      directory(join(parent, ".trash"));
      if (existsSync(join(parent, ".trash", location.sessionId))) throw missing();
    }
    // Caller-generated UUIDs make retried create requests idempotent.
    if (existsSync(target)) return this.use(location, (db) => db.read());
    const temporary = join(parent, `.${location.sessionId}.${randomUUID()}.creating`);
    directory(temporary, true);
    try {
      const filename = join(temporary, "session.sqlite");
      writeFileSync(filename, "", { flag: "wx", mode: 0o600 });
      const db = new SessionDatabase(filename, location, settings);
      let result;
      try { result = db.read(); } finally { db.close(); }
      syncDirectory(temporary);
      renameSync(temporary, target);
      syncDirectory(parent);
      return result;
    } finally { rmSync(temporary, { force: true, recursive: true }); }
  }
  remove(location: SessionLocation, revision: number) {
    this.project(location);
    const parent = projectDirectory(this.root, location.projectId, false);
    const trash = join(parent, ".trash");
    directory(trash, true);
    const destination = join(trash, location.sessionId);
    if (existsSync(destination)) {
      directory(destination);
      if (existsSync(join(parent, location.sessionId))) throw storageError();
      return;
    }
    // Tombstone inside the database first, so other open connections cannot append after deletion.
    this.use(location, (db) => db.retire(revision));
    renameSync(join(parent, location.sessionId), destination);
    syncDirectory(parent); syncDirectory(trash);
  }
  list() {
    const sessions: SessionSummary[] = [];
    const warnings: string[] = [];
    for (const project of this.projects.list()) {
      let names;
      try { names = readdirSync(projectDirectory(this.root, project.id, false)); }
      catch (error) {
        if (!isMissing(error)) warnings.push(`Sessions for ${project.name} could not be read safely.`);
        continue;
      }
      for (const sessionId of names.filter(validId)) {
        try {
          const location = { projectId: project.id, sessionId };
          const document = this.use(location, (db) => db.isDeleted() ? null : db.read());
          if (document) sessions.push(summary(document));
          else this.remove(location, 0); // Finish a deletion interrupted after its durable tombstone.
        } catch {
          warnings.push(`Session ${sessionId} in ${project.name} could not be opened or recovered. Its files were left untouched.`);
        }
      }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    return { sessions, warnings };
  }
}
