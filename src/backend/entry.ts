import { Effect } from "effect";
import { startServer } from "./server.js";

const parent = process.parentPort;
if (!parent) throw new Error("The backend must be launched by Flame");
parent.once("message", (event) => {
  const { filename, token, origin } = event.data as { filename: string; token: string; origin: string };
  const controller = new AbortController();
  parent.on("message", (message) => { if (message.data === "shutdown") controller.abort(); });
  void Effect.runPromise(Effect.scoped(startServer({ filename, token, origin, ready: (port) => parent.postMessage({ port }) })), { signal: controller.signal })
    .then(() => process.exit(0), (error: unknown) => {
      if (!controller.signal.aborted) console.error("Backend failed:", error);
      process.exit(controller.signal.aborted ? 0 : 1);
    });
});
