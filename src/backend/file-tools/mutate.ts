import { destination, atomicWrite } from "./atomic-write.js";
import { assertHash, digest, maybeStat, snapshot } from "./filesystem.js";
import { replaceText } from "./edit.js";
import { withFileLock } from "./mutation-queue.js";
import { FileToolError, MAX_FILE_BYTES, type FileOperation, type FileResult } from "./types.js";

export async function mutateText(path: string, operation: Extract<FileOperation, { name: "edit" | "write" }>, signal: AbortSignal): Promise<FileResult> {
  signal.throwIfAborted();
  if (process.platform === "win32") throw new FileToolError("Atomic file mutations are not supported on Windows yet.");
  const target = await destination(path);
  return withFileLock(target, signal, async () => {
    if (await destination(path) !== target) throw new FileToolError("File destination changed while waiting. Read it again.");
    const exists = await maybeStat(target);
    const before = exists ? await snapshot(target, signal) : null;
    if (operation.name === "edit" && !before) throw new FileToolError("Cannot edit a missing file. Use write to create it.");
    assertHash(before, operation.expected_sha256, operation.name === "write");
    const content = operation.name === "edit" ? replaceText(before!.text, operation.edits) : operation.content;
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_FILE_BYTES) throw new FileToolError("Result would exceed the 16 MiB file limit. Nothing was replaced.");
    signal.throwIfAborted();
    const unchanged = before?.bytes.equals(bytes) === true;
    const sha256 = digest(bytes);
    if (!unchanged) await atomicWrite(path, target, bytes, before, signal);
    return { status: "completed", path: operation.path, bytes: bytes.length, sha256,
      summary: unchanged ? "File already has the requested contents; no bytes were changed."
        : operation.name === "edit" ? `Applied ${operation.edits.length} exact replacement(s) atomically.`
        : `${before ? "Replaced" : "Created"} file atomically (${bytes.length} bytes).` };
  });
}
