import { dialog, shell, type BrowserWindow } from "electron";

export function installExternalLinks(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (url.length > 8192 || !["https:", "http:"].includes(target.protocol) || target.username || target.password) return { action: "deny" };
      void shell.openExternal(target.href).catch(() => {
        if (!window.isDestroyed()) void dialog.showMessageBox(window, { type: "error", message: "Could not open the link in your browser.", buttons: ["OK"] }).catch(() => {});
      });
    } catch { /* Never pass local files or unrecognized protocols to the OS. */ }
    return { action: "deny" };
  });
}
