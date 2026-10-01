import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_ICON_PATH } from "./appIcon.js";

/** The launcher entry the packaged app is built with, e.g. "flame.desktop"; it names the window's app ID on Wayland. */
async function desktopName(): Promise<string | null> {
  try {
    const name: unknown = JSON.parse(await readFile(join(app.getAppPath(), "package.json"), "utf8")).desktopName;
    return typeof name === "string" && /^[a-z0-9-]+\.desktop$/.test(name) ? name : null;
  } catch { return null; }
}
const escapeExec = (path: string) => `"${path.replace(/(["`$\\])/g, "\\$1")}"`;
async function writeIfChanged(path: string, content: string | Buffer) {
  const current = await readFile(path).catch(() => null);
  if (current && Buffer.compare(current, Buffer.from(content)) === 0) return;
  await writeFile(path, content, { mode: 0o644 });
}

/**
 * An AppImage installs nothing, so launchers and Wayland bars cannot find Flame's name and icon. Writes its launcher
 * entry and icon into the user's data directory, pointing at wherever the AppImage is now. The .deb installs its own.
 */
export async function installAppImageEntry(): Promise<void> {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== "linux" || !app.isPackaged || !appImage) return;
  const name = await desktopName();
  if (!name) return;
  const id = name.slice(0, -".desktop".length);
  const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const icons = join(data, "icons", "hicolor", "512x512", "apps"), applications = join(data, "applications");
  await mkdir(icons, { recursive: true });
  await mkdir(applications, { recursive: true });
  await writeIfChanged(join(icons, `${id}.png`), await readFile(APP_ICON_PATH));
  await writeIfChanged(join(applications, name), [
    "[Desktop Entry]", "Type=Application", `Name=${app.getName()}`, "Comment=Desktop app for coding agents",
    `Exec=${escapeExec(appImage)} %U`, `TryExec=${appImage}`, `Icon=${id}`, "Terminal=false", "Categories=Development;",
    "Keywords=code;agent;ai;git;", `StartupWMClass=${id}`, "",
  ].join("\n"));
}
