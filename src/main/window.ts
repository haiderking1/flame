import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { INITIAL_ZOOM_LEVEL, windowTitlebarOptions } from "./windowAppearance.js";
import { installExternalLinks } from "./externalLinks.js";
import { trackWindowZoom, refreshZoomLayout } from "./windowZoom.js";

const rendererPath = fileURLToPath(new URL("../renderer/index.html", import.meta.url));

export async function createWindow(): Promise<BrowserWindow> {
  const devUrl = !app.isPackaged ? process.env.FLAME_RENDERER_URL : undefined;
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 840,
    minHeight: 620,
    title: "Flame",
    ...windowTitlebarOptions(),
    backgroundColor: "#0b0b0b",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL("./bootstrap.cjs", import.meta.url)),
      zoomFactor: 1.2 ** INITIAL_ZOOM_LEVEL,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  trackWindowZoom(window);
  installExternalLinks(window);
  window.webContents.on("will-navigate", (event, url) => {
    // Vite reloads this same URL when the HTML changes.
    if (!devUrl || url !== devUrl) event.preventDefault();
  });

  try {
    if (devUrl) {
      await window.loadURL(devUrl);
    } else {
      await window.loadFile(rendererPath);
    }
    await refreshZoomLayout(window);
    window.show();
    return window;
  } catch (error) {
    window.destroy();
    throw error;
  }
}
