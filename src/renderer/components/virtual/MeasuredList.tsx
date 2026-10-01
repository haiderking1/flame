import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { adjustNestedSize } from "./scrollSizing";

type Props<T> = { items: readonly T[]; itemKey(item: T): string; render(item: T): ReactNode; scroll: RefObject<HTMLDivElement | null>; estimate?: number; threshold?: number; windowAnchor?: boolean };
/** Flow layout below the threshold, measured windowing for large histories. */
export function MeasuredList<T>({ items, itemKey, render, scroll, estimate = 120, threshold = 80, windowAnchor = false }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0), [, updateSelection] = useState(0);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const restoreTimer = useRef(0);
  useLayoutEffect(() => () => clearTimeout(restoreTimer.current), []);
  const retained = useRef(new Set<string>());
  const indices = useMemo(() => new Map(items.map((item, index) => [itemKey(item), index])), [items, itemKey]);
  const windowed = items.length > threshold;
  const getScrollElement = useCallback(() => scroll.current, [scroll]);
  const getItemKey = useCallback((index: number) => itemKey(items[index]!), [items, itemKey]);
  const virtual = useVirtualizer({ count: items.length, getScrollElement, getItemKey, estimateSize: () => estimate, overscan: 8,
    useAnimationFrameWithResizeObserver: true,
    initialOffset: () => scroll.current?.scrollTop ?? 0,
    enabled: windowed, scrollMargin: offset, anchorTo: windowAnchor ? "end" : "start", followOnAppend: false,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...[...retained.current, ...(restoreKey ? [restoreKey] : [])].map(key => indices.get(key)).filter((index): index is number => index !== undefined)])].sort((a, b) => a - b),
  });
  virtual.shouldAdjustScrollPositionOnItemSizeChange = windowAnchor ? undefined : (item, _delta, instance) => adjustNestedSize(item, instance, root.current);
  useLayoutEffect(() => {
    const parent = scroll.current, element = root.current;
    if (!parent || !element || !windowed) return;
    let frame = 0;
    const measureOffset = () => { const position = element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop; setOffset(old => Math.abs(old - position) < .25 ? old : position); };
    measureOffset();
    const observer = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measureOffset(); }); }); observer.observe(parent); observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [windowed, scroll, virtual]);
  useLayoutEffect(() => {
    const element = root.current; if (!windowed || !windowAnchor || !element) return;
    const restore = (event: Event) => {
      const key: unknown = (event as CustomEvent<{ key: unknown }>).detail?.key;
      if (typeof key !== "string" || !indices.has(key)) return;
      setRestoreKey(key); clearTimeout(restoreTimer.current); restoreTimer.current = window.setTimeout(() => setRestoreKey(null), 400);
    };
    element.addEventListener("restore-history-anchor", restore);
    return () => { element.removeEventListener("restore-history-anchor", restore); };
  }, [windowed, windowAnchor, indices]);
  useLayoutEffect(() => {
    if (!windowed) return;
    // Keep focused and selected rows mounted until the interaction ends.
    const preserve = () => {
      const next = new Set<string>();
      const selection = document.getSelection();
      for (const node of [document.activeElement, selection?.anchorNode, selection?.focusNode]) {
        const element = node instanceof Element ? node : node?.parentElement;
        let row = element?.closest<HTMLElement>("[data-virtual-index]");
        while (row && row.parentElement !== root.current) row = row.parentElement?.closest<HTMLElement>("[data-virtual-index]");
        if (row && row.parentElement === root.current) next.add(row.dataset.virtualKey!);
      }
      const selected = [...next].map(key => indices.get(key)).filter((index): index is number => index !== undefined).sort((a, b) => a - b);
      if (selection && !selection.isCollapsed && selected.length > 1) for (let index = selected[0]!; index <= selected.at(-1)!; index++) next.add(itemKey(items[index]!));
      if ([...next].join() !== [...retained.current].join()) { retained.current = next; updateSelection(value => value + 1); }
    };
    preserve();
    document.addEventListener("selectionchange", preserve); document.addEventListener("focusin", preserve); document.addEventListener("focusout", preserve);
    return () => { document.removeEventListener("selectionchange", preserve); document.removeEventListener("focusin", preserve); document.removeEventListener("focusout", preserve); };
  }, [windowed, virtual, indices, items, itemKey]);
  if (!windowed) return <div ref={root}>{items.map(item => <div key={itemKey(item)} data-virtual-key={itemKey(item)}>{render(item)}</div>)}</div>;
  return <div ref={root} data-virtual-list="true" data-history-window={windowAnchor || undefined} style={{ position: "relative", height: virtual.getTotalSize() }}>
    {virtual.getVirtualItems().map(row => <div key={row.key} className="virtual-measured-row" data-index={row.index} data-virtual-index={row.index} data-virtual-key={row.key} ref={virtual.measureElement}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - virtual.options.scrollMargin}px)` }}>{render(items[row.index]!)}</div>)}
  </div>;
}
