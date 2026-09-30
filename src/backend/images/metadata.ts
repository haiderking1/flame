import { Schema } from "effect";
import { ImageInfo } from "../../contracts/image-types.js";
import { hashImage } from "./files.js";
import type { PreparedImage } from "./normalize.js";

export function imageMetadata(id: string, name: string, original: Uint8Array, prepared: PreparedImage): typeof ImageInfo.Type {
  return Schema.decodeUnknownSync(ImageInfo)({ id, name, mimeType: prepared.originalMime, bytes: original.length,
    width: prepared.width, height: prepared.height, modelWidth: prepared.modelWidth, modelHeight: prepared.modelHeight,
    sha256: hashImage(original), modelSha256: hashImage(prepared.data), modelBytes: prepared.data.length, modelMimeType: prepared.mimeType });
}
