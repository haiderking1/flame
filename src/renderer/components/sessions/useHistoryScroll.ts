import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { SessionEntry } from "@contracts/sessions";

export function useHistoryScroll(container: RefObject<HTMLDivElement | null>, sessionKey: string, entries: readonly SessionEntry[], liveText = "") {
  const following = useRef(true);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const scroll = () => { following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 64; };
    element.addEventListener("scroll", scroll, { passive: true });
    return () => element.removeEventListener("scroll", scroll);
  }, [container]);
  const previous = useRef({ sessionKey: "", first: "", last: "", height: 0 });
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const first = entries[0]?.id ?? "", last = entries.at(-1)?.id ?? "";
    const old = previous.current;
    if (old.sessionKey !== sessionKey) { following.current = true; element.scrollTop = element.scrollHeight; }
    else if (old.first !== first && old.last === last) element.scrollTop += element.scrollHeight - old.height;
    else if (following.current) element.scrollTop = element.scrollHeight;
    previous.current = { sessionKey, first, last, height: element.scrollHeight };
  }, [entries, sessionKey, container, liveText]);
}
