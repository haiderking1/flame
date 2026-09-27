import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { startDevServer } from "./dev-server.mjs";

const server = await startDevServer();
server.printUrls();
const child = spawn(electron, ["."], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit",
  env: { ...process.env, FLAME_RENDERER_URL: server.resolvedUrls.local[0] },
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
  killTimer.unref();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await server.close();
}

child.once("exit", (code, signal) => {
  void stop(code ?? (signal === "SIGTERM" ? 0 : 1));
});
child.once("error", (error) => {
  console.error("Could not launch Electron:", error);
  void stop(1);
});
process.once("SIGINT", () => { void stop(0); });
process.once("SIGTERM", () => { void stop(0); });
