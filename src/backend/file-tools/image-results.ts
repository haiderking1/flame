import { Schema } from "effect";
import { ImageInfo } from "../../contracts/image-types.js";
import type { ImageStore } from "../images/store.js";
import type { FileResult } from "./types.js";

// Stored outcomes are JSON metadata. Only backend model context contains image bytes.
export function imageResultOutput(encoded: string, images: ImageStore): string | unknown[] {
  let result: FileResult;
  try { result = JSON.parse(encoded) as FileResult; } catch { return encoded; }
  if (!result || result.status !== "completed" || !result.image) return encoded;
  const image = Schema.decodeUnknownSync(ImageInfo)(result.image);
  const saved = images.info(image.id);
  if (!saved || saved.modelSha256 !== image.modelSha256 || saved.sha256 !== image.sha256) throw new Error("The saved image read result is unavailable or changed.");
  return [{ type: "input_text", text: encoded }, ...images.content([image.id])];
}
export function expandImageResults(output: unknown[], images?: ImageStore): unknown[] {
  if (!images) return output;
  return output.map(value => {
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "function_call_output" || !("output" in value) || typeof value.output !== "string") return value;
    return { ...value, output: imageResultOutput(value.output, images) };
  });
}
