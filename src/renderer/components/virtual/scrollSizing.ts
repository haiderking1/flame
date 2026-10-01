import type { VirtualItem } from "@tanstack/react-virtual";
interface ScrollSizing {
  scrollElement: HTMLElement | null;
  scrollOffset: number | null;
  scrollDirection: string | null;
  itemSizeCache: ReadonlyMap<VirtualItem["key"], number>;
}
/** Let the enclosing measured row compensate once when a nested list is entirely above the viewport. */
export function adjustNestedSize(item: VirtualItem, instance: ScrollSizing, root: HTMLElement | null) {
  const viewport = instance.scrollElement;
  if (!viewport) return false;
  for (let parent = root?.parentElement?.closest<HTMLElement>(".virtual-measured-row"); parent; parent = parent.parentElement?.closest<HTMLElement>(".virtual-measured-row")) {
    if (parent.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().top + viewport.clientTop) return false;
  }
  const offset = instance.scrollOffset ?? 0;
  return instance.itemSizeCache.has(item.key) ? item.end <= offset && instance.scrollDirection !== "backward" : item.start < offset;
}
