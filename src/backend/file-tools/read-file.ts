import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { MAX_IMAGE_BYTES } from "../../contracts/image-types.js";
import { imageMetadata } from "../images/metadata.js";
import { normalizeImage, ImagePreparationError, type PreparedImage } from "../images/normalize.js";
import { byteSnapshot, existingPath, textSnapshot } from "./filesystem.js";
import { readText } from "./read.js";
import { FileToolError, type FileOperation, type FileResult } from "./types.js";

export type ReadImage = { original: Buffer; prepared: PreparedImage };
export type ReadOutcome = { result: FileResult; image?: ReadImage };
function isImage(bytes: Buffer, path: string) {
  return /\.(png|jpe?g|gif|webp)$/i.test(extname(path))
    || bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
    || bytes[0] === 255 && bytes[1] === 216
    || bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}
export async function readFile(path: string, operation: Extract<FileOperation, { name: "read" }>, signal: AbortSignal, supportsImages = true): Promise<ReadOutcome> {
  const file = await byteSnapshot(await existingPath(path), signal, MAX_IMAGE_BYTES);
  if (!isImage(file.bytes, path)) return { result: await readText(path, operation, signal, textSnapshot(file)) };
  if (!supportsImages) throw new FileToolError("This model does not accept images. Choose an image-capable model to inspect this file; no image was sent.");
  let prepared: PreparedImage;
  try { prepared = await normalizeImage(file.bytes, signal); }
  catch (error) { if (error instanceof ImagePreparationError) throw new FileToolError(error.message); throw error; }
  signal.throwIfAborted();
  const name = basename(path).replace(/[\u0000-\u001f]/g, "\uFFFD").slice(0, 255).replace(/[\uD800-\uDBFF]$/, "") || "Image";
  const image = imageMetadata(randomUUID(), name, file.bytes, prepared);
  return { result: { status: "completed", path: operation.path, sha256: file.hash, bytes: file.bytes.length, image,
    summary: `Read image (${image.mimeType}), ${image.width}×${image.height}; sent as ${image.modelWidth}×${image.modelHeight}. Animated images are sent as a still frame. offset and limit apply only to text.` },
    image: { original: file.bytes, prepared } };
}
