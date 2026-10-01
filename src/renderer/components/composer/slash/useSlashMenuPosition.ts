import { useLayoutEffect, useState, type RefObject } from "react";

export type SlashMenuPosition = { left: number; bottom: number; width: number; maxHeight: number };

export function useSlashMenuPosition(input: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<SlashMenuPosition | null>(null);
  useLayoutEffect(() => {
    const composer = input.current?.closest<HTMLElement>(".composer");
    if (!composer) return;
    let frame = 0;
    function measure() {
      frame = 0;
      if (!composer?.isConnected) return;
      const bounds = composer.getBoundingClientRect();
      const unit = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const inset = unit * 1.375;
      const overlap = unit + 1;
      const next: SlashMenuPosition = {
        left: bounds.left + inset,
        bottom: innerHeight - bounds.top - overlap,
        width: Math.max(0, bounds.width - inset * 2),
        maxHeight: Math.max(0, bounds.top - 24 + overlap),
      };
      setPosition(previous => previous && previous.left === next.left && previous.bottom === next.bottom
        && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    measure();
    const observer = new ResizeObserver(schedule);
    // Side panels can move a fixed-width composer without resizing the composer itself.
    for (let element: HTMLElement | null = composer; element; element = element.parentElement) observer.observe(element);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [input]);
  return position;
}
