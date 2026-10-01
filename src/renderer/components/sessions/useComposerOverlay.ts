import { useLayoutEffect, useRef, type RefObject } from "react";

// The history scrolls behind the floating composer. Reserve its actual height
// at the end so the final message stays reachable as drafts/errors resize it.
// A resting composer keeps the full composer's reserve, so expanding it again never covers what was in view.
export function useComposerOverlay(composer: RefObject<HTMLDivElement | null>, history: RefObject<HTMLDivElement | null>, resting = false) {
  const restingNow = useRef(resting); restingNow.current = resting;
  useLayoutEffect(() => {
    const element = composer.current;
    const host = element?.closest<HTMLElement>(".workspace__chat");
    if (!element || !host) return;
    let previous = -1;
    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (!height || height === previous || (restingNow.current && height < previous)) return;
      previous = height;
      const timeline = history.current;
      const following = timeline && timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 64;
      host.style.setProperty("--composer-overlay-height", `${height}px`);
      if (timeline && following) timeline.scrollTop = timeline.scrollHeight;
    };
    measure();
    // Applied on the next frame: changing the reserve inside the observer callback resizes the history's own observed rows in
    // the same frame, which the browser reports as a ResizeObserver loop.
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); host.style.removeProperty("--composer-overlay-height"); };
  }, [composer, history]);
}
