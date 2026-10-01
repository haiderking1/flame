import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Why this build cannot update itself, or null when it can: only installed builds with an update feed do, and on Linux
 * only the AppImage and the .deb, which electron-updater knows how to replace.
 */
export function disabledReason(): string | null {
  if (!app.isPackaged) return "Updates are only available in installed builds of Flame.";
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) return "This build of Flame has no update feed.";
  if (process.env.FLAME_DISABLE_AUTO_UPDATE) return "Updates are turned off by FLAME_DISABLE_AUTO_UPDATE.";
  if (process.platform === "linux" && !process.env.APPIMAGE && !isDeb()) return "Updates on Linux need the AppImage or the .deb package of Flame.";
  return null;
}
// electron-builder marks a .deb install in resources/package-type.
function isDeb() {
  try { return readFileSync(join(process.resourcesPath, "package-type"), "utf8").trim() === "deb"; } catch { return false; }
}
