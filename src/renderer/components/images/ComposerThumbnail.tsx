import { useEffect, useState } from "react";
import { imageThumbnail } from "./thumbnail";
export function ComposerThumbnail({ file, name }: { file: Blob; name: string }) {
  const [image, setImage] = useState<{ file: Blob; url: string } | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true, url: string | undefined; setFailed(false);
    void imageThumbnail(file).then(blob => {
      if (!live) return;
      if (!blob) { setFailed(true); return; }
      url = URL.createObjectURL(blob); setImage({ file, url });
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return image?.file === file && !failed ? <img src={image.url} alt={name} onError={() => setFailed(true)} /> : <span>{failed ? "Unavailable" : "Image"}</span>;
}
