import { DEFAULT_LS_LIMIT, FileToolError, MAX_ARGUMENT_BYTES, MAX_OUTPUT_LINES, type FileOperation, type Replacement } from "./types.js";
const invalid = (message: string): never => { throw new FileToolError(message); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Arguments must be a JSON object.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("Unexpected tool argument. Follow the tool schema exactly.");
}
export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.includes("\0") || Buffer.from(value, "utf8").toString("utf8") !== value) return invalid(`${label} must be valid Unicode text without NUL characters.`);
  return value;
}
export function parseOperation(name: string, encoded: string): FileOperation {
  if (Buffer.byteLength(encoded) > MAX_ARGUMENT_BYTES) invalid("File tool arguments exceed the 1 MiB encoded limit.");
  let raw: unknown;
  try { raw = JSON.parse(encoded); } catch { return invalid("Tool arguments are not valid JSON."); }
  const args = object(raw);
  const path = text(name === "ls" && (args.path == null || args.path === "") ? "." : args.path, "path");
  if (!path.trim() || Buffer.byteLength(path) > 4096) invalid("path must be nonempty and at most 4096 bytes.");
  if (name === "ls") {
    keys(args, ["path", "limit"]);
    const limit = args.limit ?? DEFAULT_LS_LIMIT;
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) invalid("limit must be a positive integer.");
    return { name, path, limit: limit as number };
  }
  if (name === "read") {
    keys(args, ["path", "offset", "limit"]);
    const offset = args.offset ?? 1, limit = args.limit ?? MAX_OUTPUT_LINES;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 1) invalid("offset must be a positive 1-based integer.");
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OUTPUT_LINES) invalid("limit must be between 1 and 2000.");
    return { name, path, offset: offset as number, limit: limit as number };
  }
  const expected = args.expected_sha256;
  if (expected !== null && (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))) invalid("expected_sha256 must be the lowercase hash returned by read, or null.");
  const expected_sha256 = expected as string | null;
  if (name === "write") {
    keys(args, ["path", "content", "expected_sha256"]);
    return { name, path, content: text(args.content, "content"), expected_sha256 };
  }
  if (name === "edit") {
    keys(args, ["path", "edits", "expected_sha256"]);
    if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 100) invalid("edits must contain between 1 and 100 replacements.");
    const edits = (args.edits as unknown[]).map(value => {
      const edit = object(value); keys(edit, ["oldText", "newText"]);
      const oldText = text(edit.oldText, "oldText"), newText = text(edit.newText, "newText");
      if (!oldText) invalid("oldText must not be empty. Use write to create a file.");
      return { oldText, newText } satisfies Replacement;
    });
    return { name, path, edits, expected_sha256 };
  }
  return invalid("Unknown file tool.");
}
