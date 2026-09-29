import { Schema } from "effect";

export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_CHUNK_BYTES = 24 * 1024;
export const ImageId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
export const ImageIds = Schema.Array(ImageId).check(Schema.isMaxLength(MAX_IMAGES));
export const ImageInfo = Schema.Struct({
  id: ImageId, name: Schema.String, mimeType: Schema.String, bytes: Schema.Number,
  width: Schema.Number, height: Schema.Number, modelWidth: Schema.Number, modelHeight: Schema.Number,
  sha256: Schema.String, modelSha256: Schema.String, modelBytes: Schema.Number, modelMimeType: Schema.String,
});
export type ImageInfo = typeof ImageInfo.Type;
