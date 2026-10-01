import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { launchBackend } from "./backend.js";
import { createWindow } from "./window.js";
import { installApplicationMenu } from "./applicationMenu.js";
import { installImageUploadOrigin } from "./imageUploadOrigin.js";
import { installNotifications } from "./notifications.js";

function handleStartupError(error: unknown): void {
  console.error("Failed to open Flame:", error);
  dialog.showErrorBox(
    "Flame could not start",
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

if (primary) void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const backend = await launchBackend(() => handleStartupError(new Error("The backend stopped unexpectedly. Restart Flame to reconnect.")));
  installImageUploadOrigin(session.defaultSession, backend.url);
  ipcMain.handle("flame:connection", (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted bootstrap request");
    return backend.url;
  });
  let stopping = false;
  app.on("before-quit", (event) => {
    if (stopping) return;
    event.preventDefault();
    stopping = true;
    void backend.stop().finally(() => app.quit());
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch(handleStartupError);
    }
  });

  installApplicationMenu();
  installNotifications();
  await createWindow();
}).catch(handleStartupError);
