import { useId } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import { uploadImage, discardImage } from "../../backend/images";
import type { DraftImage } from "./draft-storage";
export function useUploadImages() {
  const key = useId();
  const upload = useAtomSet(uploadImage(key), { mode: "promise" }), discard = useAtomSet(discardImage(key), { mode: "promise" });
  return async (location: SessionLocation, images: readonly DraftImage[], signal?: AbortSignal) => {
    for (const image of images) {
      signal?.throwIfAborted();
      const cancel = () => { void discard({ ...location, id: image.id }).catch(() => {}); };
      signal?.addEventListener("abort", cancel, { once: true });
      try { await upload({ ...location, image, signal }); signal?.throwIfAborted(); }
      finally { signal?.removeEventListener("abort", cancel); }
    }
    signal?.throwIfAborted();
  };
}
