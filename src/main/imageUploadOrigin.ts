import { BrowserWindow, webContents, type Session } from "electron";
import { needsImageUploadOrigin } from "./imageUploadOriginPolicy.js";

export function installImageUploadOrigin(session: Session, backendUrl: string): void {
  const backend = new URL(backendUrl);
  const rendererUrl = new URL("../renderer/index.html", import.meta.url).href;
  session.webRequest.onBeforeSendHeaders({ urls: [`http://${backend.host}/images/upload*`] }, (details, callback) => {
    const contents = details.webContentsId === undefined ? undefined : webContents.fromId(details.webContentsId);
    const frame = details.frame;
    const origin = Object.entries(details.requestHeaders).find(([name]) => name.toLowerCase() === "origin")?.[1];
    if (needsImageUploadOrigin({ url: details.url, method: details.method, origin }, backendUrl,
      frame?.url ?? "", rendererUrl, !!contents && !!BrowserWindow.fromWebContents(contents) && frame === contents.mainFrame)) {
      const headers = { ...details.requestHeaders };
      for (const name of Object.keys(headers)) if (name.toLowerCase() === "origin") delete headers[name];
      callback({ requestHeaders: { ...headers, Origin: "null" } });
    } else callback({});
  });
}
