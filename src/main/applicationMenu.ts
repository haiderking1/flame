import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { zoomWindow, type ZoomDirection } from "./windowZoom.js";

export function installApplicationMenu(): void {
  const zoom = (direction: ZoomDirection) => () => {
    void zoomWindow(BrowserWindow.getFocusedWindow(), direction).catch((error: unknown) => {
      console.error("Could not change window zoom:", error);
    });
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { id: "zoom-reset", label: "Actual Size", accelerator: "CmdOrCtrl+0", click: zoom("reset") },
      { id: "zoom-in", label: "Zoom In", accelerator: "CmdOrCtrl+=", click: zoom("in") },
      { id: "zoom-plus", label: "Zoom In", accelerator: "CmdOrCtrl+Plus", visible: false, click: zoom("in") },
      { id: "zoom-out", label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: zoom("out") },
      { type: "separator" },
      { role: "togglefullscreen" },
    ] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
