import type { ImageInfo } from "@contracts/image-types";
import type { SessionLocation } from "@contracts/sessions";
import { imageDigest, uploadImageBinary } from "../../backend/image-upload";
import type { DraftImage } from "./draft-storage";
import { ImageUploadQueue } from "./upload-queue";

export const imageUploads = new ImageUploadQueue(uploadImageBinary, 3, imageDigest);
export function restoreImageUploads(location: SessionLocation, images: readonly DraftImage[], lookup: (ids: readonly string[]) => Promise<readonly ImageInfo[]>) {
  return imageUploads.restore(location, images, async ids => {
    const ready = await lookup(ids);
    const matching = await Promise.all(ready.map(async info => {
      const image = images.find(image => image.id === info.id);
      return image && image.name === info.name && image.file.size === info.bytes && await imageDigest(image.file) === info.sha256 ? info : null;
    }));
    return matching.filter((info): info is ImageInfo => info !== null);
  });
}
