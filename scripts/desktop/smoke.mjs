/**
 * Checks a packaged Flame: its backend modules work from inside app.asar, the app starts and talks to its backend, and on
 * Linux the AppImage beside it adds itself to the app launcher.
 *
 *   node scripts/desktop/smoke.mjs [path to the unpacked app directory, default release/linux-unpacked]
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const app = resolve(process.argv[2] ?? join(root, "release", "linux-unpacked"));
const layout = directory => {
  const name = readdirSync(directory).find(file => /^flame(-nightly)?(\.exe)?$/i.test(file) || file.endsWith(".app"));
  if (process.platform === "darwin") return { executable: join(directory, "Contents", "MacOS", basename(directory, ".app")), asar: join(directory, "Contents", "Resources", "app.asar") };
  return { executable: join(directory, name ?? "flame"), asar: join(directory, "resources", "app.asar") };
};
assert.ok(existsSync(app) && existsSync(layout(app).asar), `No packaged app at ${app}. Run bun run dist:desktop first.`);
const home = await mkdtemp(join(tmpdir(), "flame-smoke-"));
// Run a copy outside the repository: from inside it, Node would also find the repository's own node_modules.
const copy = join(home, basename(app));
await cp(app, copy, { recursive: true, verbatimSymlinks: true });
const { executable, asar } = layout(copy);
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
delete env.FLAME_RENDERER_URL;

try {
  // 1. The backend's packaged dependencies, from inside the archive.
  const runtime = spawnSync(executable, [fileURLToPath(new URL("smoke-runtime.mjs", import.meta.url)), asar, home], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 60_000 });
  assert.ok(runtime.stdout.includes("FLAME_PACKAGED_RUNTIME_OK"), `Packaged runtime check failed:\n${runtime.stdout}${runtime.stderr}`);

  // 2. The app itself: the window loads and the backend answers over its RPC connection.
  const child = spawn(executable, ["--ozone-platform=headless", "--remote-debugging-port=0", `--user-data-dir=${join(home, "profile")}`], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  try {
    const browser = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Flame did not start:\n${output}`)), 30_000);
      const read = chunk => { output += chunk; const match = /DevTools listening on (ws:\/\/\S+)/.exec(output); if (match) { clearTimeout(timer); resolve(new URL(match[1])); } };
      child.stdout.on("data", read); child.stderr.on("data", read);
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Flame exited (${code}):\n${output}`)); });
    });
    const page = await waitFor(async () => (await (await fetch(`http://${browser.host}/json/list`)).json()).find(target => target.type === "page"), "the window");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const evaluate = expression => new Promise((resolve, reject) => {
      const call = ++id;
      const listen = event => { const message = JSON.parse(event.data); if (message.id !== call) return; socket.removeEventListener("message", listen);
        message.result?.exceptionDetails ? reject(new Error(message.result.exceptionDetails.text)) : resolve(message.result?.result?.value); };
      socket.addEventListener("message", listen);
      socket.send(JSON.stringify({ id: call, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
    await waitFor(() => evaluate("!!document.querySelector('.sidebar-footer button')"), "the app shell");
    await evaluate("document.querySelector('.sidebar-footer button').click()");
    // Providers lists both sign-ins once the backend has sent the sign-in state.
    await waitFor(() => evaluate("document.querySelectorAll('.provider-row .provider-row__sign-in:not(:disabled)').length === 2"), "the backend to answer");
    socket.close();
  } finally { await stop(child); }
  // 3. On Linux, the AppImage adds itself to the app launcher with its icon.
  const appImage = process.platform === "linux" ? readdirSync(dirname(app)).find(name => name.endsWith(".AppImage")) : undefined;
  if (appImage) {
    const path = join(dirname(app), appImage), data = join(home, "data");
    const launched = spawn(path, ["--ozone-platform=headless", `--user-data-dir=${join(home, "appimage-profile")}`],
      // It extracts into TMPDIR, here inside the scratch folder, so the copy goes when the folder does.
      { env: { ...env, APPIMAGE_EXTRACT_AND_RUN: "1", XDG_DATA_HOME: data, TMPDIR: home }, stdio: "ignore", detached: true });
    try {
      const entry = await waitFor(() => readdirSync(join(data, "applications")).find(name => name.endsWith(".desktop")), "the launcher entry");
      const text = readFileSync(join(data, "applications", entry), "utf8"), id = entry.slice(0, -".desktop".length);
      assert.ok(/^Name=Flame( \(Nightly\))?$/m.test(text) && text.includes(`Exec="${path}" %U`) && text.includes(`Icon=${id}`) && text.includes(`StartupWMClass=${id}`), `Unexpected launcher entry:\n${text}`);
      assert.ok(statSync(join(data, "icons", "hicolor", "512x512", "apps", `${id}.png`)).size > 1000, "the icon is installed");
    } finally { await stop(launched); }
  }
  console.log(`Packaged Flame works: native search, image worker, SQLite, window and backend${appImage ? ", and the AppImage's launcher entry" : ""}.`);
} finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }

/** Stops a launched app with everything it started (Electron's helper processes, the AppImage's extracted copy), and waits for it. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  await exited;
}

async function waitFor(check, what) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { const value = await check(); if (value) return value; } catch { /* Not ready yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}
