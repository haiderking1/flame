import { useLayoutEffect, type RefObject } from "react";

// The history scrolls behind the floating composer. Reserve its actual height
// at the end so the final message stays reachable as drafts/errors resize it.
export function useComposerOverlay(composer: RefObject<HTMLDivElement | null>, history: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = composer.current;
    const host = element?.closest<HTMLElement>(".workspace__chat");
    if (!element || !host) return;
    let previous = -1;
    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (!height || height === previous) return;
      previous = height;
      const timeline = history.current;
      const following = timeline && timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 64;
      host.style.setProperty("--composer-overlay-height", `${height}px`);
      if (timeline && following) timeline.scrollTop = timeline.scrollHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); host.style.removeProperty("--composer-overlay-height"); };
  }, [composer, history]);
}
