import { useEffect, useState } from "react";
import { cachedThumbnailUrl, retainThumbnailUrl } from "./thumbnail-url";
export function ComposerThumbnail({ file, name }: { file: Blob; name: string }) {
  const [image, setImage] = useState<{ file: Blob; url: string } | null>(() => {
    const url = cachedThumbnailUrl(file); return url ? { file, url } : null;
  }), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; setFailed(false);
    const preview = retainThumbnailUrl(file);
    void preview.ready.then(url => {
      if (!live) return;
      if (!url) { setFailed(true); return; }
      setImage({ file, url });
    });
    return () => { live = false; preview.release(); };
  }, [file]);
  return image?.file === file && !failed ? <img src={image.url} alt={name} onError={() => setFailed(true)} /> : <span>{failed ? "Unavailable" : "Image"}</span>;
}
