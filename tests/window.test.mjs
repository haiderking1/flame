import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import electron from "electron";
import { startDevServer } from "../scripts/dev-server.mjs";
import { checkComposer } from "./helpers/composer.mjs";
import { checkFonts } from "./helpers/fonts.mjs";
import { checkTitlebar } from "./helpers/titlebar.mjs";
import { checkResponsive } from "./helpers/responsive.mjs";
import { checkWorkspace } from "./helpers/workspace.mjs";
import { checkSidebar } from "./helpers/sidebar.mjs";
import { checkSidebarRestore } from "./helpers/sidebarRestore.mjs";
import { checkProjects } from "./helpers/projects.mjs";
import { checkProjectFilter } from "./helpers/projectFilter.mjs";
import { checkSettings } from "./helpers/settings.mjs";
import { checkComposerSubmission } from "./helpers/composerSubmission.mjs";

for (const mode of ["production", "development"]) {
test(`${mode}: composer window${mode === "development" ? " with live updates" : ""}`, { timeout: 35_000 }, async (t) => {
  let root;
  let server;
  const env = { ...process.env };
  delete env.FLAME_RENDERER_URL;
  if (mode === "development") {
    root = await mkdtemp(fileURLToPath(new URL("../.flame-test-", import.meta.url)));
    t.after(async () => {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    });
    await cp(new URL("../src/renderer/", import.meta.url), root, { recursive: true });
    server = await startDevServer(root);
    env.FLAME_RENDERER_URL = server.resolvedUrls.local[0];
  }
  const profile = await mkdtemp(join(tmpdir(), "flame-test-profile-"));
  env.HOME = profile;
  env.USERPROFILE = profile;
  const authPath = join(profile, '.flame', 'agent', 'auth.json');
  if (mode === 'development') {
    await mkdir(join(profile, '.flame', 'agent'), { recursive: true, mode: 0o700 });
    await writeFile(authPath, JSON.stringify({ 'openai-codex': {
      type: 'oauth', access: 'fake-access-token', refresh: 'fake-refresh-token', expires: Date.now() + 3_600_000,
      accountId: 'test-account', email: 'test@example.com', plan: 'plus',
    }, other: { preserved: true } }), { mode: 0o600 });
  }
  const child = spawn(electron, [".", "--ozone-platform=headless", "--remote-debugging-pipe", `--user-data-dir=${profile}`], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    env,
  });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  child.on("error", (error) => { diagnostics += String(error); });
  const exited = once(child, "exit").catch(() => {});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    if (!t.passed) console.error(diagnostics);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  let id = 0;
  let buffer = "";
  const pending = new Map();
  child.stdio[4].setEncoding("utf8");
  child.stdio[4].on("data", (chunk) => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf("\0")) !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });

  async function send(method, params = {}, sessionId) {
    const requestId = ++id;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${method} timed out\n${diagnostics}`)), 5_000);
        pending.set(requestId, { resolve, reject });
        child.stdio[3].write(JSON.stringify({ id: requestId, method, params, sessionId }) + "\0");
      });
    } finally {
      clearTimeout(timer);
      pending.delete(requestId);
    }
  }

  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    const { targetInfos } = await send("Target.getTargets");
    page = targetInfos.find((target) => target.type === "page" && target.url.startsWith(
      mode === "development" ? env.FLAME_RENDERER_URL : "file:",
    ));
    if (page) break;
    await delay(50);
  }
  assert.ok(page, `Renderer never opened\n${diagnostics}`);
  const { sessionId } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    assert.equal(response.exceptionDetails, undefined);
    return response.result.value;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("document.readyState === 'complete' && document.querySelector('textarea') !== null && document.title === 'Flame'")) break;
    await delay(50);
  }
  assert.deepEqual(await evaluate(`({
    ready: document.readyState,
    title: document.title,
    composer: Boolean(document.querySelector('form[aria-label="Message composer"]')),
    background: getComputedStyle(document.documentElement).backgroundColor,
    require: typeof globalThis.require,
    process: typeof globalThis.process
  })`), {
    ready: "complete", title: "Flame", composer: true,
    background: "rgb(11, 11, 11)", require: "undefined", process: "undefined",
  });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await checkTitlebar(evaluate);
  assert.equal(await evaluate("window.open('about:blank') === null"), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await checkFonts(evaluate);
  await evaluate(`(() => {
    const toggle = document.querySelector('.app-shell > .sidebar-toggle');
    if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await checkWorkspace(evaluate);
  await checkSidebar({ evaluate, send: (method, params) => send(method, params, sessionId) });
  await checkSidebarRestore({ evaluate, send: (method, params) => send(method, params, sessionId) });
  await checkResponsive({ evaluate, send: (method, params) => send(method, params, sessionId) });
  await mkdir(join(profile, 'folders', 'child'), { recursive: true });
  await checkProjects({ evaluate, send: (method, params) => send(method, params, sessionId), folder: join(profile, 'folders') });
  await checkProjectFilter({ evaluate, send: (method, params) => send(method, params, sessionId), folder: join(profile, 'folders') });
  await evaluate("document.querySelector('[aria-label=\"New thread\"]').click()");
  for (let i = 0; i < 100 && !await evaluate("!!document.querySelector('.session-dialog select')"); i++) await delay(20);
  await evaluate(`(() => { const select = document.querySelector('.session-dialog select'); select.value = [...select.options].find(option => option.value).value; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate("document.querySelector('.session-dialog button[type=submit]').click()");
  for (let i = 0; i < 100 && !await evaluate("!!document.querySelector('.session-history:not([hidden])') && !document.querySelector('.session-dialog')"); i++) await delay(20);
  assert.equal(await evaluate("document.querySelector('textarea').readOnly"), false);
  await checkSettings({ evaluate, send: (method, params) => send(method, params, sessionId), savedAuthPath: mode === 'development' ? authPath : undefined });
  if (mode === "production") {
    await checkComposer({ evaluate, send: (method, params) => send(method, params, sessionId) });
  } else {
    await evaluate("document.querySelector('textarea').focus()");
    await send("Input.insertText", { text: "draft preserved" }, sessionId);
  }

  if (mode === "development") {
    // Wait for the HMR client connection before changing the temporary fixture.
    for (let attempt = 0; attempt < 100 && server.ws.clients.size === 0; attempt++) await delay(50);
    assert.ok(server.ws.clients.size > 0, "Vite HMR WebSocket did not connect");
    await evaluate("window.__hmrMarker = 'preserved'");
    const stylesheet = join(root, "style.css");
    const css = await readFile(stylesheet, "utf8");
    await writeFile(stylesheet, css.replace("#0b0b0b", "#223344"));
    let background;
    for (let attempt = 0; attempt < 100; attempt++) {
      background = await evaluate("getComputedStyle(document.documentElement).backgroundColor");
      if (background === "rgb(34, 51, 68)") break;
      await delay(50);
    }
    assert.equal(background, "rgb(34, 51, 68)", "CSS update did not reach the window");
    assert.equal(await evaluate("window.__hmrMarker"), "preserved", "CSS update reloaded the page");

    const appPath = join(root, "App.tsx");
    await writeFile(appPath, (await readFile(appPath, "utf8")).replace("Flame workspace", "Updated workspace"));
    let label;
    for (let attempt = 0; attempt < 100; attempt++) {
      label = await evaluate("document.querySelector('main')?.getAttribute('aria-label')");
      if (label === "Updated workspace") break;
      await delay(50);
    }
    assert.equal(label, "Updated workspace", "React Fast Refresh did not update the component");
    assert.equal(await evaluate("document.querySelector('textarea').value"), "draft preserved");
    assert.equal(await evaluate("window.__hmrMarker"), "preserved");

    await checkComposerSubmission(appPath, evaluate);

    const htmlPath = join(root, "index.html");
    await writeFile(htmlPath, (await readFile(htmlPath, "utf8")).replace("<title>Flame</title>", "<title>Flame updated</title>"));
    let title;
    for (let attempt = 0; attempt < 100; attempt++) {
      title = await evaluate("document.title");
      if (title === "Flame updated") break;
      await delay(50);
    }
    assert.equal(title, "Flame updated", "HTML update did not reload the page");
  }
});
}
