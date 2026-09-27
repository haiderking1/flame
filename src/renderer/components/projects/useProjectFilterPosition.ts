import { useLayoutEffect, type RefObject } from "react";

export function useProjectFilterPosition(open: boolean, popup: RefObject<HTMLDivElement | null>, anchor: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!open || !popup.current || !anchor.current) return;
    const element = popup.current;
    const target = anchor.current;
    function position() {
      const bounds = target.getBoundingClientRect();
      const availableWidth = Math.max(0, window.innerWidth - 16);
      element.style.minWidth = `${Math.min(bounds.width, 288, availableWidth)}px`;
      element.style.maxWidth = `${Math.min(288, availableWidth)}px`;
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const flip = below < Math.min(element.scrollHeight, 200) && above > below;
      element.style.maxHeight = `${Math.max(0, Math.min(368, flip ? above : below))}px`;
      const rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - rect.width - 8))}px`;
      element.style.top = `${flip ? bounds.top - rect.height - 4 : bounds.bottom + 4}px`;
    }
    const observer = new ResizeObserver(position);
    observer.observe(target);
    observer.observe(element);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    position();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, popup, anchor]);
}
