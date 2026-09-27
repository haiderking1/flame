import { app, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function launchBackend(onUnexpectedExit: () => void) {
  const directory = join(app.getPath("userData"), "data");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const devUrl = !app.isPackaged ? process.env.FLAME_RENDERER_URL : undefined;
  const child = utilityProcess.fork(fileURLToPath(new URL("../backend/entry.js", import.meta.url)), [], { serviceName: "Flame backend", stdio: "pipe" });
  child.stderr?.on("data", (data: Buffer) => console.error(data.toString()));
  let stopping = false;
  let started = false;
  child.on("exit", () => { if (started && !stopping) onUnexpectedExit(); });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Backend startup timed out")); }, 15_000);
      const failed = () => { cleanup(); reject(new Error("Backend exited during startup")); };
      const ready = (message: unknown) => {
        const port = (message as { port?: unknown })?.port;
        if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return;
        cleanup(); resolve(port);
      };
      function cleanup() { clearTimeout(timer); child.removeListener("message", ready); child.removeListener("exit", failed); }
      child.on("message", ready);
      child.once("exit", failed);
      child.once("spawn", () => child.postMessage({ filename: join(directory, "flame.sqlite"), token, origin: devUrl ? new URL(devUrl).origin : "file://" }));
    });
    started = true;
    return {
      url: `ws://127.0.0.1:${port}/rpc?token=${token}`,
      stop: () => new Promise<void>((resolve) => {
        stopping = true;
        if (!child.pid) { resolve(); return; }
        const timer = setTimeout(() => child.kill(), 3_000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        child.postMessage("shutdown");
      }),
    };
  } catch (error) { stopping = true; child.kill(); throw error; }
}
