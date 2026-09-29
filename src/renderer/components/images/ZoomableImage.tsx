import { useEffect, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
export type ImagePan = { pan(key: string): boolean };
export function ZoomableImage({ src, name, onError, ref }: { src: string; name: string; onError(): void; ref?: Ref<ImagePan> }) {
  const viewport = useRef<HTMLDivElement>(null), zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1), [natural, setNatural] = useState({ width: 0, height: 0 });
  const [windowSize, setWindowSize] = useState({ width: innerWidth, height: innerHeight });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null), moved = useRef(false);
  const anchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const maxHeight = Math.max(1, Math.min(windowSize.height * .86, windowSize.height - 160));
  const maxWidth = Math.max(1, windowSize.width * .92 - (windowSize.width >= 640 ? 96 : 0));
  const fit = Math.min(1, maxWidth / (natural.width || 1), maxHeight / (natural.height || 1));
  const width = natural.width * fit * zoom, height = natural.height * fit * zoom;
  function change(next: number, x?: number, y?: number) {
    const node = viewport.current, previous = zoomRef.current, value = Math.max(1, Math.min(8, next));
    if (!node || value === previous) return;
    const bounds = node.getBoundingClientRect(), px = x ?? bounds.left + node.clientWidth / 2, py = y ?? bounds.top + node.clientHeight / 2;
    anchor.current = { x: (node.scrollLeft + px - bounds.left) / previous, y: (node.scrollTop + py - bounds.top) / previous, clientX: px, clientY: py };
    zoomRef.current = value; setZoom(value);
  }
  useLayoutEffect(() => {
    const point = anchor.current, node = viewport.current;
    if (point && node) { const bounds = node.getBoundingClientRect(); node.scrollLeft = point.x * zoom - point.clientX + bounds.left; node.scrollTop = point.y * zoom - point.clientY + bounds.top; anchor.current = null; }
  }, [zoom]);
  useImperativeHandle(ref, () => ({ pan(key) {
    const node = viewport.current; if (!node || zoomRef.current <= 1) return false;
    if ((key === "ArrowLeft" || key === "ArrowRight") && node.scrollWidth <= node.clientWidth) return false;
    if (key === "ArrowLeft") node.scrollLeft -= 40; else if (key === "ArrowRight") node.scrollLeft += 40;
    else if (key === "ArrowUp") node.scrollTop -= 40; else if (key === "ArrowDown") node.scrollTop += 40; else return false;
    return true;
  } }), []);
  useEffect(() => {
    const resize = () => { setWindowSize({ width: innerWidth, height: innerHeight }); change(1); };
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const node = viewport.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return; event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      change(zoomRef.current * Math.exp(-delta * (event.ctrlKey ? .01 : .002)), event.clientX, event.clientY);
    };
    node.addEventListener("wheel", wheel, { passive: false }); return () => node.removeEventListener("wheel", wheel);
  }, []);
  return <div ref={viewport} className="image-zoom flame-scrollbar" role="region" aria-label={`${name}, zoomable image`} tabIndex={0}
    aria-description="Click or press Enter to toggle zoom. Scroll or use plus and minus to zoom. Drag or use arrows to pan. Press 0 to fit."
    style={{ width: width || undefined, height: height || undefined, maxWidth, maxHeight, cursor: zoom > 1 ? dragging ? "grabbing" : "grab" : "zoom-in" }}
    onClick={event => { if (!moved.current && event.detail <= 1) change(zoomRef.current > 1 ? 1 : 2, event.clientX, event.clientY); }}
    onKeyDown={event => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (["Enter", " ", "+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === "0") change(1); else if (event.key === "-") change(zoomRef.current / 1.5);
        else if (event.key === "+" || event.key === "=") change(zoomRef.current * 1.5);
        else if (!event.repeat) change(zoomRef.current > 1 ? 1 : 2);
      }
    }}
    onPointerDown={event => {
      moved.current = false;
      if (drag.current || event.pointerType !== "mouse" || event.button !== 0 || zoomRef.current <= 1) return;
      const node = event.currentTarget, bounds = node.getBoundingClientRect();
      if (event.clientX - bounds.left >= node.clientWidth || event.clientY - bounds.top >= node.clientHeight) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
      node.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => {
      const start = drag.current; if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) moved.current = true;
      event.currentTarget.scrollLeft = start.left + start.x - event.clientX; event.currentTarget.scrollTop = start.top + start.y - event.clientY;
    }}
    onPointerUp={event => { if (drag.current?.id === event.pointerId) { event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; setDragging(false); } }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
    <img src={src} alt={name} draggable={false} style={{ width: width || undefined, height: height || undefined, maxWidth: natural.width ? undefined : maxWidth, maxHeight: natural.height ? undefined : maxHeight }}
      onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={onError} />
    <span className="image-sr-only" aria-live="polite">{Math.round(zoom * 100)}% zoom</span>
  </div>;
}
