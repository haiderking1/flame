import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useImageUrl, type ImageSource } from "./useImageUrl";
import { ZoomableImage, type ImagePan } from "./ZoomableImage";
import "./images.css";
function ViewedImage({ source, pan }: { source: ImageSource; pan: React.RefObject<ImagePan | null> }) {
  const image = useImageUrl(source);
  if (image.failed) return <div className="image-viewer__state" role="alert">Image unavailable or could not be decoded.<button onClick={image.retry}>Retry</button></div>;
  if (!image.url) return <div className="image-viewer__state" role="status">Loading image…</div>;
  return <ZoomableImage ref={pan} src={image.url} name={source.name} onError={image.fail} />;
}
export function ImageViewer({ images, initial, onClose }: { images: readonly ImageSource[]; initial: number; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), pan = useRef<ImagePan>(null), close = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(initial);
  const item = images[index];
  const navigate = (direction: number) => setIndex(index => (index + direction + images.length) % images.length);
  useEffect(() => {
    const opener = document.activeElement, node = dialog.current!;
    node.showModal(); close.current?.focus();
    return () => { node.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (!item) onClose(); }, [item, onClose]);
  return createPortal(<dialog ref={dialog} className="image-viewer" aria-label="Expanded image preview"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if (pan.current?.pan(event.key)) { event.preventDefault(); event.stopPropagation(); return; }
      if (images.length > 1 && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); navigate(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
    {images.length > 1 && <button className="image-viewer__nav image-viewer__prev" aria-label="Previous image" onClick={() => navigate(-1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
    {item && <div className="image-viewer__content">
      <button ref={close} className="image-viewer__close" aria-label="Close image preview" onClick={onClose}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      <ViewedImage key={item.id} source={item} pan={pan} />
      <div className="image-viewer__caption" aria-live="polite">{item.name}{images.length > 1 ? ` (${index + 1}/${images.length})` : ""}</div>
    </div>}
    {images.length > 1 && <button className="image-viewer__nav image-viewer__next" aria-label="Next image" onClick={() => navigate(1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
  </dialog>, document.body);
}
