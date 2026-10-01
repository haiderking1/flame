import { app, BrowserWindow, ipcMain, nativeImage, Notification, type IpcMainInvokeEvent } from "electron";
import { appIcon } from "./appIcon.js";

type Shown = { notification: Notification; owner: BrowserWindow };
const shown = new Map<string, Shown>();
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(value) ? value : null;
function owner(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted notification request");
  return window;
}
function clear() {
  for (const { notification } of shown.values()) notification.close();
  shown.clear();
  if (process.platform === "win32") for (const window of BrowserWindow.getAllWindows()) window.setOverlayIcon(null, "");
  else app.setBadgeCount(0);
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("flame:notifications-cleared");
}
/**
 * Native thread notifications and the app's unread badge (T3 Code's desktop bridge). A notification with the same tag
 * replaces the earlier one; clicking one brings the window forward and opens the thread; focusing any window clears
 * them all and the badge.
 */
export function installNotifications() {
  ipcMain.handle("flame:notifications-supported", event => { owner(event); return Notification.isSupported(); });
  ipcMain.handle("flame:notify", (event, payload: unknown) => {
    const window = owner(event);
    const input = payload as { tag?: unknown; title?: unknown; body?: unknown } | null;
    const tag = text(input?.tag, 200), title = text(input?.title, 120), body = text(input?.body, 300);
    if (!tag || !title || !body) throw new Error("Invalid notification");
    if (!Notification.isSupported() || window.isFocused()) return false;
    shown.get(tag)?.notification.close();
    const notification = new Notification({ title, body, silent: true, icon: appIcon() });
    notification.on("click", () => {
      shown.delete(tag);
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
      window.webContents.send("flame:notification-open", tag);
    });
    notification.on("close", () => { if (shown.get(tag)?.notification === notification) shown.delete(tag); });
    shown.set(tag, { notification, owner: window });
    notification.show();
    return true;
  });
  ipcMain.handle("flame:badge", (event, payload: unknown) => {
    const window = owner(event);
    const input = payload as { count?: unknown; image?: unknown } | null;
    const count = typeof input?.count === "number" && Number.isSafeInteger(input.count) && input.count >= 0 && input.count <= 999 ? input.count : null;
    const image = input?.image === null || (typeof input?.image === "string" && input.image.startsWith("data:image/png;base64,") && input.image.length <= 16384) ? input.image : undefined;
    if (count === null || image === undefined) throw new Error("Invalid badge");
    // The badge counts threads waiting while Flame is in the background; a focused window has seen them.
    const shownCount = BrowserWindow.getAllWindows().some(item => item.isFocused()) ? 0 : count;
    if (process.platform === "win32") window.setOverlayIcon(shownCount && image ? nativeImage.createFromDataURL(image) : null, shownCount ? `${shownCount} threads with new notifications` : "");
    else app.setBadgeCount(shownCount);
  });
  app.on("browser-window-focus", clear);
  app.on("before-quit", clear);
}
