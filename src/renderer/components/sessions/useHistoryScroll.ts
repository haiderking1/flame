import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { SessionEntry } from "@contracts/sessions";

export function useHistoryScroll(container: RefObject<HTMLDivElement | null>, sessionKey: string, entries: readonly SessionEntry[], liveText = "") {
  const following = useRef(true);
  const anchor = useRef<{ id: string; key: string; offset: number } | null>(null);
  const anchorFrame = useRef(0);
  function captureAnchor() {
    const element = container.current; if (!element) return;
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>("[data-history-entry]")].find(row => row.getBoundingClientRect().bottom > top + 1);
    anchor.current = row ? { id: row.dataset.historyEntry!, key: row.closest<HTMLElement>("[data-virtual-key]")?.dataset.virtualKey ?? row.dataset.historyEntry!, offset: row.getBoundingClientRect().top - top } : null;
  }
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const scroll = () => { following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 64; };
    let frame = 0;
    const resize = new ResizeObserver(() => {
      previous.current.height = element.scrollHeight;
      if (!following.current || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (following.current) element.scrollTop = element.scrollHeight; });
    });
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) following.current = false; anchor.current = null; cancelAnimationFrame(anchorFrame.current); };
    element.addEventListener("scroll", scroll, { passive: true });
    element.addEventListener("wheel", wheel, { passive: true });
    return () => { resize.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(anchorFrame.current); element.removeEventListener("scroll", scroll); element.removeEventListener("wheel", wheel); };
  }, [container]);
  const previous = useRef({ sessionKey: "", first: "", last: "", height: 0, windowed: false });
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const first = entries[0]?.id ?? "", last = entries.at(-1)?.id ?? "";
    const old = previous.current;
    const windowed = !!element.querySelector("[data-history-window]");
    if (old.sessionKey !== sessionKey) { anchor.current = null; cancelAnimationFrame(anchorFrame.current); following.current = true; element.scrollTop = element.scrollHeight; }
    else if (old.first !== first && old.last === last && !(old.windowed && windowed)) {
      element.scrollTop += element.scrollHeight - old.height;
      if (windowed && anchor.current) element.querySelector("[data-history-window]")?.dispatchEvent(new CustomEvent("restore-history-anchor", { detail: { key: anchor.current.key } }));
      let frames = 0, stable = 0;
      const restore = () => {
        const saved = anchor.current; if (!saved) return;
        const row = element.querySelector<HTMLElement>(`[data-history-entry="${saved.id}"]`);
        if (row) {
          const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset;
          if (Math.abs(delta) > 1) { element.scrollTop += delta; stable = 0; } else stable++;
        }
        if (++frames < 20 && stable < 3) anchorFrame.current = requestAnimationFrame(restore); else anchor.current = null;
      };
      cancelAnimationFrame(anchorFrame.current); anchorFrame.current = requestAnimationFrame(restore);
    }
    else if (following.current) element.scrollTop = element.scrollHeight;
    previous.current = { sessionKey, first, last, height: element.scrollHeight, windowed };
  }, [entries, sessionKey, container, liveText]);
  return captureAnchor;
}
