import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionError, SessionLocation } from "./sessions.js";
import { ImageId, ImageInfo, MAX_IMAGE_BYTES, IMAGE_CHUNK_BYTES } from "./image-types.js";

const location = { ...SessionLocation.fields, id: ImageId };
const Offset = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: MAX_IMAGE_BYTES }));
export const ImageRpc = RpcGroup.make(
  Rpc.make("images.begin", { payload: { ...location, name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
    bytes: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_IMAGE_BYTES })),
    sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)) }, success: Schema.NullOr(ImageInfo), error: SessionError }),
  Rpc.make("images.chunk", { payload: { ...location, offset: Offset, data: Schema.String.check(Schema.isMaxLength(IMAGE_CHUNK_BYTES / 3 * 4)) }, success: Schema.Void, error: SessionError }),
  Rpc.make("images.finish", { payload: location, success: ImageInfo, error: SessionError }),
  Rpc.make("images.read", { payload: { ...location, offset: Offset, preview: Schema.optionalKey(Schema.Boolean) }, success: Schema.Struct({ data: Schema.String, next: Schema.NullOr(Offset) }), error: SessionError }),
  Rpc.make("images.discard", { payload: location, success: Schema.Void, error: SessionError }),
);
