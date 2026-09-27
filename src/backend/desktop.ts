import { randomUUID } from "node:crypto";
import { OAuthFailure } from "./auth/credentials.js";

export function openBrowser(parent: NonNullable<typeof process.parentPort>, url: string): Promise<void> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new OAuthFailure("The browser could not be opened. Try again.")); }, 10_000);
    const listener = (event: { data: unknown }) => {
      const data = event.data as { type?: string; id?: string; ok?: boolean } | null;
      if (data?.type !== "browser-result" || data.id !== id) return;
      cleanup();
      if (data.ok === true) resolve();
      else reject(new OAuthFailure("The browser could not be opened. Check your default browser and try again."));
    };
    function cleanup() { clearTimeout(timer); parent.removeListener("message", listener); }
    parent.on("message", listener);
    parent.postMessage({ type: "open-browser", id, url });
  });
}
