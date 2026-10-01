import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type Credential, decodeChatGPTCredential, decodeCodexCredential, isChatGPT } from "./credentials.js";
import { prepareAuthDirectory, readPrivateFile, storageFailure } from "./private-files.js";

const CODEX = "openai-codex", CHATGPT = "openai-chatgpt", HOST = "openai-agent-host";
const HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * ~/.flame/agent/auth.json: the OpenAI sign-in, under the key of its method, and this installation's agent host ID, which
 * OpenAI ties Sign in with ChatGPT registrations to and which outlives signing out. Other entries are left as they are.
 */
export class AuthStore {
  private readonly filename: string;
  private writes = Promise.resolve();
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
      if (data[CHATGPT] !== undefined) return decodeChatGPTCredential(data[CHATGPT]);
      return data[CODEX] === undefined ? null : decodeCodexCredential(data[CODEX]);
    } catch { throw storageFailure(); }
  }
  /** Saves the sign-in, replacing one of the other method; null signs out. */
  save(credential: Credential | null) {
    return this.write(data => {
      delete data[CODEX]; delete data[CHATGPT];
      if (credential && isChatGPT(credential)) data[CHATGPT] = decodeChatGPTCredential(credential);
      else if (credential) data[CODEX] = decodeCodexCredential(credential);
    });
  }
  /** This installation's stable agent host ID, created on first use. */
  async agentHostId(): Promise<string> {
    let id = "";
    await this.write(data => {
      if (typeof data[HOST] === "string" && HOST_ID.test(data[HOST])) { id = data[HOST]; return false; }
      id = `urn:uuid:${randomUUID()}`;
      data[HOST] = id;
    });
    return id;
  }
  /** Read, change and atomically replace the file, one change at a time; `false` from the change skips the write. */
  private write(change: (data: Record<string, unknown>) => void | false) {
    const task = this.writes.then(async () => {
      const temporary = join(this.directory, `.auth-${randomUUID()}.tmp`);
      try {
        const data = await this.read();
        if (change(data) === false) return;
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
    });
    this.writes = task.catch(() => {});
    return task;
  }
}
