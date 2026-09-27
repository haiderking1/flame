import type { BrowserWindowConstructorOptions } from "electron";

export const INITIAL_ZOOM_LEVEL = 3;

export function windowTitlebarOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "linux") {
    return { frame: false };
  }
  if (process.platform === "darwin") {
    return { titleBarStyle: "hiddenInset" };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#01000000", symbolColor: "#f8fafc", height: 40 },
  };
}
