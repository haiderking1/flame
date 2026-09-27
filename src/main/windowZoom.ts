import type { BrowserWindow } from "electron";

export type ZoomDirection = "in" | "out" | "reset";

export async function zoomWindow(window: BrowserWindow | null, direction: ZoomDirection): Promise<void> {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  const contents = window.webContents;
  contents.setZoomLevel(direction === "reset" ? 0 : contents.getZoomLevel() + (direction === "in" ? 0.5 : -0.5));
  await refreshZoomLayout(window);
}

/** Keep the frameless Linux header at native size while the page zooms. */
export function trackWindowZoom(window: BrowserWindow): void {
  if (process.platform !== "linux") return;
  const contents = window.webContents;
  let cssKey: string | undefined;
  let revision = 0;
  const refresh = async () => {
    const current = ++revision;
    try {
      const key = await contents.insertCSS(`:root { --titlebar-height: ${40 / contents.getZoomFactor()}px !important; }`);
      if (contents.isDestroyed()) return;
      if (current !== revision) {
        await contents.removeInsertedCSS(key);
        return;
      }
      const previous = cssKey;
      cssKey = key;
      if (previous) await contents.removeInsertedCSS(previous);
    } catch (error) {
      if (!contents.isDestroyed()) console.error("Could not update window header:", error);
    }
  };
  contents.on("did-finish-load", () => { cssKey = undefined; void refresh(); });
  // Also cover Chromium-originated zoom and window resizing.
  contents.on("zoom-changed", () => { void refresh(); });
  window.on("resize", () => { void refresh(); });
  zoomRefreshers.set(window, refresh);
  window.once("closed", () => { revision++; zoomRefreshers.delete(window); });
}

const zoomRefreshers = new WeakMap<BrowserWindow, () => Promise<void>>();

export async function refreshZoomLayout(window: BrowserWindow): Promise<void> {
  await zoomRefreshers.get(window)?.();
}
