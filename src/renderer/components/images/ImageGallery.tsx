import { useEffect, useRef, useState } from "react";
import { ComposerThumbnail } from "./ComposerThumbnail";
import { ImageViewer } from "./ImageViewer";
import { useImageUrl, type ImageSource } from "./useImageUrl";
import "./images.css";
function Thumbnail({ source, onOpen, onRemove, disabled }: { source: ImageSource; onOpen(): void; onRemove?: () => void; disabled?: boolean }) {
  const element = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    if (element.current) observer.observe(element.current); return () => observer.disconnect();
  }, []);
  const image = useImageUrl(source, true, visible && !("file" in source));
  return <div ref={element} className="image-thumbnail">
    <button type="button" className="image-thumbnail__open" aria-label={`Preview ${source.name}`} title={source.name} onClick={onOpen}>
      {"file" in source ? <ComposerThumbnail file={source.file} name={source.name} /> : image.url && !image.failed ? <img src={image.url} alt={source.name} onError={image.fail} /> : <span>{image.failed ? "Unavailable" : "Image"}</span>}
    </button>
    {onRemove && <button type="button" className="image-thumbnail__remove" disabled={disabled} aria-label={`Remove ${source.name}`} onClick={onRemove}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
  </div>;
}
export function ImageGallery({ images, onRemove, disabled = false, draft = false }: { images: readonly ImageSource[]; onRemove?: (id: string) => void; disabled?: boolean; draft?: boolean }) {
  const [preview, setPreview] = useState<{ images: readonly ImageSource[]; index: number } | null>(null);
  if (!images.length && !preview) return null;
  return <><div className={`image-gallery${draft ? " image-gallery--draft" : ""}`} aria-label={draft ? "Attached images" : "Message images"}>
    {images.map((image, index) => <Thumbnail key={image.id} source={image} disabled={disabled} onOpen={() => setPreview({ images: [...images], index })} {...(onRemove ? { onRemove: () => onRemove(image.id) } : {})} />)}
  </div>{preview && <ImageViewer images={preview.images} initial={preview.index} onClose={() => setPreview(null)} />}</>;
}
