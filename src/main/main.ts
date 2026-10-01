import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { launchBackend } from "./backend.js";
import { createWindow } from "./window.js";
import { appIcon } from "./appIcon.js";
import { installApplicationMenu } from "./applicationMenu.js";
import { installImageUploadOrigin } from "./imageUploadOrigin.js";
import { installNotifications } from "./notifications.js";
import { installAppImageEntry } from "./linuxDesktopEntry.js";
import { DesktopUpdates } from "./updates/desktopUpdates.js";

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
  if (process.platform === "darwin") app.dock?.setIcon(appIcon());
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
  const updates = new DesktopUpdates({ prepareToInstall: async () => {
    // The updater quits Flame itself; the backend stops first, and the updated Flame may start before this one exits.
    stopping = true;
    await backend.stop();
    app.releaseSingleInstanceLock();
  } });
  await updates.start();
  app.on("will-quit", () => updates.stop());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch(handleStartupError);
    }
  });

  installApplicationMenu({ checkForUpdates: () => updates.checkFromMenu(BrowserWindow.getFocusedWindow()) });
  installNotifications();
  void installAppImageEntry().catch((error: unknown) => { console.error("Could not add Flame to the app launcher:", error); });
  await createWindow();
}).catch(handleStartupError);
