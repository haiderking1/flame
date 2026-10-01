import { randomUUID } from "node:crypto";
import { OAuthFailure } from "./auth/credentials.js";

type Parent = NonNullable<typeof process.parentPort>;
/** Asks the Electron main process to perform a desktop action and waits for its reply. */
function desktopRequest(parent: Parent, request: { type: string; [key: string]: unknown }, reply: string, failure: () => Error): Promise<void> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(failure()); }, 10_000);
    const listener = (event: { data: unknown }) => {
      const data = event.data as { type?: string; id?: string; ok?: boolean } | null;
      if (data?.type !== reply || data.id !== id) return;
      cleanup();
      if (data.ok === true) resolve(); else reject(failure());
    };
    function cleanup() { clearTimeout(timer); parent.removeListener("message", listener); }
    parent.on("message", listener);
    parent.postMessage({ ...request, id });
  });
}
export function openBrowser(parent: Parent, url: string): Promise<void> {
  return desktopRequest(parent, { type: "open-browser", url }, "browser-result", () => new OAuthFailure("The browser could not be opened. Check your default browser and try again."));
}
/** Opens a local file with the user's default application. */
export function openPath(parent: Parent, path: string): Promise<void> {
  return desktopRequest(parent, { type: "open-path", path }, "path-result", () => new Error("The file could not be opened."));
}
