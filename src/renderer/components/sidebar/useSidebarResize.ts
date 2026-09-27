import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { loadSidebarWidth, saveSidebarWidth, sidebarMaximumWidth, SIDEBAR_MIN_WIDTH } from "./sidebarWidth";

export function useSidebarResize() {
  const [preferredWidth, setPreferredWidth] = useState(loadSidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const frame = useRef<number | null>(null);
  const minimum = SIDEBAR_MIN_WIDTH;
  const maximum = sidebarMaximumWidth(viewportWidth);
  const clamp = (value: number) => Math.min(maximum, Math.max(minimum, value));
  const width = clamp(preferredWidth);

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      window.removeEventListener("resize", onResize);
      cancelFrame();
    };
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, width };
    setResizing(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const next = clamp(start.width + event.clientX - start.x);
    cancelFrame();
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setPreferredWidth(next);
    });
  }

  function stop() {
    cancelFrame();
    drag.current = null;
    setResizing(false);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const finalWidth = clamp(start.width + event.clientX - start.x);
    setPreferredWidth(finalWidth);
    saveSidebarWidth(finalWidth);
    stop();
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (drag.current) return;
    const step = event.shiftKey ? 32 : 8;
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: minimum, End: maximum }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const finalWidth = clamp(next);
    setPreferredWidth(finalWidth);
    saveSidebarWidth(finalWidth);
  }

  return { width, minimum, maximum, resizing, handleProps: {
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: stop,
    onLostPointerCapture: stop, onKeyDown,
  } };
}
