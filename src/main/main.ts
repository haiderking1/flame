import { app, BrowserWindow, dialog, session } from "electron";
import { createWindow } from "./window.js";
import { installApplicationMenu } from "./applicationMenu.js";

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

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch(handleStartupError);
    }
  });

  installApplicationMenu();
  await createWindow();
}).catch(handleStartupError);
