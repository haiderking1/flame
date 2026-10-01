import { Fragment, useLayoutEffect, useRef, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
export function VirtualOptions<T>({ items, itemKey, selectedIndex, render, rowHeight = 40 }: {
  items: readonly T[]; itemKey(item: T): string; selectedIndex: number; render(item: T, index: number): ReactNode; rowHeight?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const windowed = items.length > 100;
  const virtual = useVirtualizer({ count: items.length, enabled: windowed, useAnimationFrameWithResizeObserver: true, getScrollElement: () => root.current, getItemKey: index => itemKey(items[index]!), estimateSize: () => rowHeight, overscan: 6,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...(selectedIndex >= 0 && selectedIndex < items.length ? [selectedIndex] : [])])].sort((a, b) => a - b),
  });
  useLayoutEffect(() => { if (windowed && selectedIndex >= 0) virtual.scrollToIndex(selectedIndex, { align: "auto" }); }, [selectedIndex, windowed, virtual]);
  if (!windowed) return <>{items.map((item, index) => <Fragment key={itemKey(item)}>{render(item, index)}</Fragment>)}</>;
  return <div ref={root} data-virtual-options="true" style={{ overflow: "auto", maxHeight: 240 }}><div style={{ position: "relative", height: virtual.getTotalSize() }}>
    {virtual.getVirtualItems().map(row => <div key={row.key} data-index={row.index} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}>{render(items[row.index]!, row.index)}</div>)}
  </div></div>;
}
