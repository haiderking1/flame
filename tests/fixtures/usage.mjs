import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { Effect } from 'effect';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { CodexUsageClient } from '../../dist/backend/usage/client.js';

void app.whenReady().then(async () => {
  let reads = 0, credits = 2, posts = 0;
  class FakeUsage extends CodexUsageClient {
    async read() { reads++; return { snapshot: { fetchedAt: Date.now(), weekly: { usedPercent: posts ? 0 : 65, resetsAt: Date.now() + 3600_000 }, availableResets: credits, canReset: false }, credits: [] }; }
    async credits() { return { available: credits, credits: [{ id: 'test-credit', title: 'Full reset (Weekly + 5 hr)', expiresAt: null }] }; }
    async consume() { posts++; await delay(150); credits--; return 'reset'; }
  }
  let ready;
  const portReady = new Promise((resolve) => { ready = resolve; });
  const abort = new AbortController();
  const running = Effect.runPromise(Effect.scoped(startServer({ filename: join(app.getPath('userData'), 'usage.sqlite'), token: 'test-token', origin: 'file://',
    openBrowser: async () => assert.fail('Usage must not start OAuth'), usageClient: new FakeUsage(), ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady;
  ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=test-token`);
  const window = await createWindow();
  const evaluate = (code) => window.webContents.executeJavaScript(code, true);
  const wait = async (code) => { for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await delay(20); } assert.fail(`Timed out: ${code}`); };
  try {
    await wait("document.querySelector('.sidebar-footer button') !== null");
    await evaluate("document.querySelector('.sidebar-footer button').click()");
    await wait("document.querySelector('.settings-navigation') !== null");
    await evaluate("[...document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === 'Usage').click()");
    await wait("document.querySelector('.usage-card__line').textContent.includes('65% used')");
    assert.equal(posts, 0);
    assert.equal(reads, 1);
    assert.ok(await evaluate("document.querySelector('.usage-card__banked').textContent.includes('2 available')"));
    await evaluate("document.querySelector('.usage-card__banked button').click()");
    await wait("document.querySelector('.reset-confirmation')?.open === true");
    assert.equal(await evaluate('document.activeElement.textContent'), 'No');
    assert.equal(posts, 0);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await wait("!document.querySelector('.reset-confirmation')");
    assert.equal(posts, 0, 'Default Enter cancels, never spends');
    await evaluate("document.querySelector('.usage-card__banked button').click()");
    await wait("document.querySelector('.reset-confirmation')?.open === true");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('.reset-confirmation')");
    assert.ok(await evaluate("!!document.querySelector('.usage-settings')"), 'Escape cancels only the dialog');
    assert.equal(posts, 0);
    await evaluate("document.querySelector('.usage-card__banked button').click()");
    await wait("document.querySelector('.reset-confirmation')?.open === true");
    await evaluate("(() => { const yes = document.querySelector('.reset-confirmation__yes'); yes.click(); yes.click(); })()");
    await wait("!document.querySelector('.reset-confirmation') && document.querySelector('.usage-card__banked').textContent.includes('1 available')");
    assert.equal(posts, 1);
    await evaluate("document.querySelector('.usage-card__header button').click()");
    await wait("!document.querySelector('.usage-card__header button').disabled");
    assert.equal(posts, 1, 'Refresh cannot spend another reset');
  } finally { window.destroy(); abort.abort(); await running; }
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
