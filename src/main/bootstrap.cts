const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
// Connection bootstrap and native notifications cross IPC. Application operations use typed RPC.
const listen = (channel: string, callback: (...args: unknown[]) => void) => {
  const listener = (_event: unknown, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
};
contextBridge.exposeInMainWorld("flame", Object.freeze({
  connection: (): Promise<string> => ipcRenderer.invoke("flame:connection"),
  notificationsSupported: (): Promise<boolean> => ipcRenderer.invoke("flame:notifications-supported"),
  notify: (notification: { tag: string; title: string; body: string }): Promise<boolean> => ipcRenderer.invoke("flame:notify", notification),
  setBadge: (badge: { count: number; image: string | null }): Promise<void> => ipcRenderer.invoke("flame:badge", badge),
  onNotificationOpen: (callback: (tag: string) => void) => listen("flame:notification-open", tag => { if (typeof tag === "string") callback(tag); }),
  onNotificationsCleared: (callback: () => void) => listen("flame:notifications-cleared", () => callback()),
}));
