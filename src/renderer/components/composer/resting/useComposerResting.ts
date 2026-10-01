import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useClientSettings } from "../../../lib/clientSettings";
import { atEnd, MIN_WIDTH_PX, scrollKeyRests, shouldRest, WheelGesture, wheelPixels } from "./restingLogic";

export type ComposerResting = {
  resting: boolean;
  /** Where the model and effort controls go while resting: inside the context strip under the composer. */
  host: HTMLElement | null; setHost(element: HTMLElement | null): void;
  /** Brings the full composer back, as using it does. */
  expand(): void;
  /** Focus entered the composer; unlike other focus, Flame's window regaining focus does not expand it. */
  focused(): void;
  /** What the composer needs shown in full: a menu, a drag or an error (held), or a draft longer than one line. */
  report(state: { held: boolean; multiline: boolean }): void;
};
export const ComposerRestingContext = createContext<ComposerResting | null>(null);
export const useComposerRestingState = () => useContext(ComposerRestingContext);

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End"]);
const scrollable = (style: CSSStyleDeclaration) => style.overflowY === "auto" || style.overflowY === "scroll";
/** Whether a scroller inside the conversation, such as a code block, takes this wheel rather than the conversation. */
function nestedScrollerTakes(target: Element, view: HTMLElement, down: boolean) {
  for (let element: Element | null = target; element && element !== view; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const style = getComputedStyle(element);
    if (!scrollable(style) || element.scrollHeight <= element.clientHeight) continue;
    if (style.overscrollBehaviorY === "contain" || style.overscrollBehaviorY === "none") return true;
    if (down ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 0) return true;
  }
  return false;
}
const editable = (element: Element | null) => !!element?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [popover]");

/**
 * T3 Code's resting composer: wheeling or paging through an existing thread's conversation rests its composer as one
 * line; reaching the end, wheeling down at the end, focusing or clicking the composer, or editing the draft brings it back.
 */
export function useComposerResting({ history, thread, sessionKey, draft }: {
  history: RefObject<HTMLElement | null>; thread: boolean; sessionKey: string; draft: string;
}): ComposerResting {
  const { composerCollapseOnScroll: enabled } = useClientSettings();
  const [scrolled, setScrolled] = useState(false), [overflows, setOverflows] = useState(false);
  const [wide, setWide] = useState(() => matchMedia(`(min-width: ${MIN_WIDTH_PX}px)`).matches);
  const [composer, setComposer] = useState({ held: false, multiline: false });
  const [host, setHost] = useState<HTMLElement | null>(null);
  const gesture = useRef(new WheelGesture()), refocusing = useRef(false);
  const canRest = enabled && thread && wide && !composer.multiline && !composer.held;
  const canRestNow = useRef(canRest); canRestNow.current = canRest;
  const resting = shouldRest({ enabled, thread, wide, overflows, scrolled, ...composer });

  // Anything that stops the composer resting also clears the gesture that rested it.
  useEffect(() => { if (!canRest) setScrolled(false); }, [canRest]);
  useLayoutEffect(() => { setScrolled(false); gesture.current.reset(); }, [sessionKey]);
  // An edit brings the composer back, and the rest of the wheel gesture cannot rest it again.
  const lastDraft = useRef(draft);
  useEffect(() => {
    if (draft === lastDraft.current) return;
    lastDraft.current = draft; setScrolled(false); gesture.current.suppress(performance.now());
  }, [draft]);
  useEffect(() => {
    const query = matchMedia(`(min-width: ${MIN_WIDTH_PX}px)`);
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const view = history.current;
    if (!view) return;
    const measure = () => setOverflows(view.scrollHeight - view.clientHeight > 1);
    const resize = new ResizeObserver(measure);
    resize.observe(view);
    if (view.firstElementChild) resize.observe(view.firstElementChild);
    measure();
    let lastTop = view.scrollTop;
    // Scrolling down to the end of the conversation brings the composer back.
    const scroll = () => {
      const towardEnd = view.scrollTop > lastTop; lastTop = view.scrollTop;
      if (towardEnd && atEnd(view)) setScrolled(false);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || !(event.target instanceof Element) || !view.contains(event.target)) return;
      const down = event.deltaY > 0;
      if (nestedScrollerTakes(event.target, view, down)) return;
      if (down && atEnd(view)) { setScrolled(false); return; }
      const canScroll = down ? view.scrollTop + view.clientHeight < view.scrollHeight - 1 : view.scrollTop > 0;
      if (!canScroll || !canRestNow.current) return;
      if (gesture.current.add(wheelPixels(event.deltaY, event.deltaMode, view.clientHeight), event.timeStamp)) setScrolled(true);
    };
    const key = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !canRestNow.current) return;
      const focus = document.activeElement;
      if (focus && focus !== document.body && !view.contains(focus)) return;
      if (editable(focus) || editable(event.target instanceof Element ? event.target : null)) return;
      if (scrollKeyRests(event.key, view)) setScrolled(true);
    };
    // Focus that comes back with Flame's window is not a request to use the composer.
    let frame = 0;
    const windowFocus = () => { refocusing.current = true; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { refocusing.current = false; }); };
    view.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("wheel", wheel, { capture: true, passive: true });
    document.addEventListener("keydown", key, true);
    window.addEventListener("focus", windowFocus);
    return () => {
      resize.disconnect(); cancelAnimationFrame(frame);
      view.removeEventListener("scroll", scroll);
      document.removeEventListener("wheel", wheel, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("focus", windowFocus);
    };
  }, [history, sessionKey]);

  const expand = useCallback(() => { setScrolled(false); gesture.current.suppress(performance.now()); }, []);
  const focused = useCallback(() => { if (!refocusing.current) expand(); }, [expand]);
  const report = useCallback((next: { held: boolean; multiline: boolean }) => {
    setComposer(current => current.held === next.held && current.multiline === next.multiline ? current : next);
  }, []);
  return useMemo(() => ({ resting, host, setHost, expand, focused, report }), [resting, host, expand, focused, report]);
}
