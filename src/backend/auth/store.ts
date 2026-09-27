import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type Credential, decodeCredential } from "./credentials.js";
import { prepareAuthDirectory, readPrivateFile, storageFailure } from "./private-files.js";

export class AuthStore {
  private readonly filename: string;
  constructor(private readonly directory: string) { this.filename = join(directory, "auth.json"); }
  private async read(): Promise<Record<string, unknown>> {
    await prepareAuthDirectory(this.directory);
    try {
      const value: unknown = JSON.parse(await readPrivateFile(this.filename));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw storageFailure();
      return value as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw storageFailure();
    }
  }
  async load(): Promise<Credential | null> {
    try {
      const data = await this.read();
      return data["openai-codex"] === undefined ? null : decodeCredential(data["openai-codex"]);
    } catch { throw storageFailure(); }
  }
  async save(credential: Credential | null) {
    const temporary = join(this.directory, `.auth-${randomUUID()}.tmp`);
    try {
      const data = await this.read();
      if (credential) data["openai-codex"] = decodeCredential(credential);
      else delete data["openai-codex"];
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, this.filename);
      if (process.platform !== "win32") {
        const directory = await open(this.directory, constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch { throw storageFailure(); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
