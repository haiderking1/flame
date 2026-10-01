import { nativeImage, type NativeImage } from "electron";
import { fileURLToPath } from "node:url";

/** Flame's app icon at 512 px, as Linux and Windows window icons expect; resources/icons/flame-1024.png is its source. */
export const APP_ICON_PATH = fileURLToPath(new URL("../../resources/icons/flame-512.png", import.meta.url));
let icon: NativeImage | undefined;

/** The app icon, for windows, the macOS dock and notifications. */
export function appIcon(): NativeImage {
  return icon ??= nativeImage.createFromPath(APP_ICON_PATH);
}
