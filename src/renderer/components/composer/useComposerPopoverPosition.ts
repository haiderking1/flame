import { useLayoutEffect, type RefObject } from "react";

export function useComposerPopoverPosition(open: boolean, popup: RefObject<HTMLDivElement | null>, anchor: RefObject<HTMLButtonElement | null>) {
  useLayoutEffect(() => {
    if (!open || !popup.current || !anchor.current) return;
    const element = popup.current;
    const button = anchor.current;
    function position() {
      const rect = button.getBoundingClientRect();
      const gap = 8;
      const above = Math.max(0, rect.top - gap * 2);
      const below = Math.max(0, innerHeight - rect.bottom - gap * 2);
      const up = above >= Math.min(280, below);
      element.style.maxHeight = `${Math.min(360, up ? above : below)}px`;
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(gap, Math.min(rect.left, innerWidth - bounds.width - gap))}px`;
      element.style.top = `${up ? rect.top - gap - bounds.height : rect.bottom + gap}px`;
      element.style.visibility = "visible";
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    observer.observe(button);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      element.style.visibility = "hidden";
    };
  }, [open, popup, anchor]);
}
