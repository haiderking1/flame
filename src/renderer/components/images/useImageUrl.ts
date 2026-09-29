import { useEffect, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import type { ImageInfo } from "@contracts/image-types";
import { downloadImage } from "../../backend/images";
export type ImageSource = { id: string; name: string; file: Blob } | { id: string; name: string; image: ImageInfo; location: SessionLocation };
export function useImageUrl(source: ImageSource, preview = false, enabled = true) {
  const key = "location" in source ? `${source.location.projectId}:${source.location.sessionId}:${source.id}:${preview}` : source.id;
  const download = useAtomSet(downloadImage(key), { mode: "promise" });
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false), [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true, objectUrl: string | undefined;
    setUrl(null); setFailed(false);
    void ("file" in source ? Promise.resolve(source.file) : download({ ...source.location, image: source.image, preview }))
      .then(blob => { if (live) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, attempt, enabled, download]);
  return { url, failed, fail: () => setFailed(true), retry: () => retry(value => value + 1) };
}
