const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
// Only connection bootstrap crosses IPC. Application operations use typed RPC.
contextBridge.exposeInMainWorld("flame", Object.freeze({
  connection: (): Promise<string> => ipcRenderer.invoke("flame:connection"),
}));
