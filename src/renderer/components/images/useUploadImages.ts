import { useId } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import { adoptImages, stagedImages } from "../../backend/images";
import type { DraftImage } from "./draft-storage";
import { imageUploads, restoreImageUploads } from "./background-uploads";

export function useUploadImages() {
  const key = useId();
  const staged = useAtomSet(stagedImages(key), { mode: "promise" });
  const adopt = useAtomSet(adoptImages(key), { mode: "promise" });
  return async (location: SessionLocation, images: readonly DraftImage[], signal?: AbortSignal) => {
    if (!images.length) return;
    signal?.throwIfAborted();
    void restoreImageUploads(location, images, ids => staged({ ...location, ids })).catch(() => {});
    await imageUploads.ready(location, images, signal);
    signal?.throwIfAborted();
    try { await adopt({ ...location, ids: images.map(image => image.id) }); }
    catch (error) { imageUploads.invalidate(location, images.map(image => image.id), "This image could not be adopted. Retry to upload or reconnect."); throw error; }
    signal?.throwIfAborted();
  };
}
