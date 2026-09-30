import type { SessionLocation } from "../../contracts/sessions.js";
import type { ToolCall } from "../bash/tools.js";
import type { Sessions } from "../sessions/service.js";
import { digest, resolvePath } from "./filesystem.js";
import { readFile, type ReadImage } from "./read-file.js";
import { imageResultOutput } from "./image-results.js";
import { listDirectory } from "./ls.js";
import { mutateText } from "./mutate.js";
import { parseOperation } from "./validation.js";
import { FileToolError, FilePersistenceFailure, fileError, type FileOperation, type FileResult } from "./types.js";

export class FileTools {
  constructor(private sessions: Sessions, private projectPath: (id: string) => string) {}
  workingDirectory(projectId: string) { return this.projectPath(projectId); }
  ledger(location: SessionLocation) {
    const entries = this.sessions.files(location, store => store.ledger());
    return entries.length ? [{ role: "user", content: [{ type: "input_text", text: `[Saved file-operation ledger, not a new human request. These are historical outcomes, not proof of current file contents. Inspect before retrying uncertain operations; never blindly replay them.]\n${JSON.stringify(entries)}` }] }] : [];
  }
  modelOutput(location: SessionLocation, encoded: string) {
    return this.sessions.images(location, images => imageResultOutput(encoded, images));
  }
  async execute(location: SessionLocation, turnId: string, call: ToolCall, signal: AbortSignal, supportsImages = true): Promise<FileResult> {
    signal.throwIfAborted();
    let operation: FileOperation, path: string;
    try {
      operation = parseOperation(call.name, call.arguments);
      path = resolvePath(this.workingDirectory(location.projectId), operation.path);
    } catch (error) {
      if (!(error instanceof FileToolError)) throw error;
      return { status: "failed", path: "", summary: "Invalid file-tool arguments. No filesystem operation was started.", error: fileError(error) };
    }
    // The durable claim precedes mkdir, temporary-file creation, and all target mutations.
    const fingerprint = digest(JSON.stringify({ operation, path }));
    try {
      const prior = this.sessions.files(location, store => store.claim(turnId, call.call_id, operation.name, operation.path, fingerprint));
      if (prior) return prior;
    } catch (error) {
      if (!(error instanceof FileToolError)) throw new FilePersistenceFailure("claim"); // Stop the loop, never invite a retry.
      return { status: "failed", path: operation.path, summary: "File operation was not started.", error: error.message };
    }
    let result: FileResult, image: ReadImage | undefined;
    const readOnly = operation.name === "ls" || operation.name === "read";
    try {
      if (operation.name === "read") {
        const read = await readFile(path, operation, signal, supportsImages); result = read.result; image = read.image;
      } else result = operation.name === "ls" ? await listDirectory(path, operation, signal) : await mutateText(path, operation, signal);
    } catch (error) {
      const uncertain = error instanceof FileToolError && error.uncertain;
      result = { status: uncertain ? "uncertain" : "failed", path: operation.path,
        summary: uncertain ? "File may have changed. Inspect before retrying."
          : readOnly ? "Read-only operation did not complete. No files were changed by this operation." : "File operation did not complete; no target file was replaced.",
        error: uncertain ? fileError(error) : signal.aborted
          ? readOnly ? "Read-only operation stopped." : "Operation stopped before a target-file commit. Newly created parent directories may remain."
          : fileError(error) };
    }
    // Record completed commits even if Stop arrived during rename/fsync. Never call them rolled back.
    try { this.sessions.files(location, store => store.finish(turnId, call.call_id, result, image)); }
    catch { throw new FilePersistenceFailure("result", readOnly); }
    return result;
  }
}
