import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { createWindow } from '../../dist/main/window.js';
import { Effect } from 'effect';
import { join } from 'node:path';
import { startServer } from '../../dist/backend/server.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';

void app.whenReady().then(async () => {
  let requests = 0;
  const modelsClient = new CodexModelsClient(async () => {
    requests++;
    return Response.json({ models: ['Alpha', 'Beta', 'GPT-5.5', 'GPT-5.6-mini'].map((name, priority) => ({ slug: `test-${name.toLowerCase()}`, display_name: name,
      description: `${name} coding model`, visibility: 'list', priority, default_reasoning_level: 'high',
      service_tiers: name === 'Beta' ? [{ id: 'priority', name: 'Fast', description: 'Increased usage' }] : [],
      supported_reasoning_levels: [{ effort: 'low', description: 'Faster reasoning' }, { effort: 'high', description: 'More reasoning' }] })) });
  });
  let ready;
  const portReady = new Promise((resolve) => { ready = resolve; });
  const abort = new AbortController();
  const running = Effect.runPromise(Effect.scoped(startServer({ filename: join(app.getPath('userData'), 'models.sqlite'), token: 'test-token', origin: 'file://',
    openBrowser: async () => assert.fail('Model browsing must not start OAuth'), modelsClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady;
  ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=test-token`);
  const window = await createWindow();
  const evaluate = (code) => window.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(20); }
    assert.fail(`Timed out: ${code}`);
  };
  async function pointer(selector, click = false) {
    const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const factor = window.webContents.getZoomFactor();
    const position = { x: Math.round(point.x * factor), y: Math.round(point.y * factor) };
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    if (click) {
      window.webContents.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    }
  }
  try {
    await wait("document.querySelectorAll('.model-picker [role=option]').length === 2");
    await evaluate("document.querySelector('.composer-settings__model').click()");
    await wait("document.querySelector('.model-picker').matches(':popover-open') && document.activeElement.getAttribute('aria-label') === 'Search models'");
    assert.ok(await evaluate("document.querySelector('.model-picker__provider img').naturalWidth > 0"));
    await wait("document.querySelectorAll('.model-picker [role=option]').length === 2");
    assert.equal(requests, 1);
    await pointer('.composer-settings__model', true);
    await wait("!document.querySelector('.model-picker').matches(':popover-open')");
    await pointer('.composer-settings__model', true);
    await wait("document.activeElement.getAttribute('aria-label') === 'Search models'");
    await pointer('.model-picker__option');
    await wait("document.querySelector('.model-picker__option').matches(':hover')");
    await pointer('.model-picker__provider');
    await wait("!document.querySelector('.model-picker__option:hover') && !document.querySelector('.model-picker__option[data-highlighted]')");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await wait("!!document.querySelector('.model-picker__option[data-highlighted]')");
    assert.ok(await evaluate("[...document.querySelectorAll('.model-picker__attribution')].every(row => row.textContent === 'Codex' && row.querySelector('img').naturalWidth > 0)"));
    assert.ok(await evaluate(`(() => {
      const list = document.querySelector('.model-picker__list');
      const input = document.querySelector('.composer__input');
      return getComputedStyle(list).scrollbarWidth === 'auto'
        && getComputedStyle(list, '::-webkit-scrollbar').width === '8px'
        && getComputedStyle(list, '::-webkit-scrollbar-thumb').backgroundColor === getComputedStyle(input, '::-webkit-scrollbar-thumb').backgroundColor;
    })()`));
    assert.equal(await evaluate("document.querySelector('.model-picker').textContent.includes('Refresh models')"), false);
    assert.equal(await evaluate("document.querySelector('.model-picker__legacy').getAttribute('aria-expanded')"), 'false');
    await evaluate("document.querySelector('.model-picker__legacy').click()");
    await wait("document.querySelectorAll('.model-picker [role=option]').length === 4");
    await evaluate("document.querySelector('.model-picker__legacy').click()");
    await wait("document.querySelectorAll('.model-picker [role=option]').length === 2");
    await window.webContents.insertText('beta');
    await wait("document.querySelectorAll('.model-picker [role=option]').length === 1");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await wait("document.querySelector('.composer-settings__label').textContent === 'Beta'");
    await wait("document.querySelector('.composer-settings__thinking').getAttribute('aria-label') === 'Thinking level: High'");
    assert.equal(await evaluate("document.querySelector('.composer-settings__thinking').disabled"), false);
    await pointer('.composer-settings__thinking', true);
    await wait("document.querySelector('.thinking-picker').matches(':popover-open')");
    assert.equal(await evaluate("document.querySelector('.thinking-picker__heading').textContent"), 'Reasoning');
    assert.equal(await evaluate("document.querySelectorAll('.thinking-picker [role=menuitemradio]').length"), 4);
    assert.equal(await evaluate("document.querySelector('.thinking-picker [aria-checked=true] .thinking-picker__default').textContent"), 'Default');
    assert.ok(await evaluate("document.activeElement.matches('.thinking-picker [aria-checked=true]')"));
    await pointer('.composer-settings__thinking', true);
    await wait("!document.querySelector('.thinking-picker').matches(':popover-open')");
    await pointer('.composer-settings__thinking', true);
    await wait("document.activeElement.matches('.thinking-picker [role=menuitemradio]')");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await wait("!document.querySelector('.thinking-picker').matches(':popover-open') && document.querySelector('.composer-settings__thinking').textContent.includes('Low')");
    await pointer('.composer-settings__thinking', true);
    await wait("document.querySelector('.thinking-picker').matches(':popover-open')");
    assert.ok(await evaluate("document.querySelector('.thinking-picker__tiers [aria-checked=true]').textContent.includes('Standard')"));
    assert.ok(await evaluate("document.querySelector('.thinking-picker__fast').textContent.includes('increased usage')"));
    await pointer('.thinking-picker__fast', true);
    await wait("!document.querySelector('.thinking-picker').matches(':popover-open') && document.querySelector('.composer-settings__thinking').textContent.includes('Fast')");
    await evaluate("document.querySelector('.composer-settings__model').click()");
    await wait("document.activeElement.getAttribute('aria-label') === 'Search models'");
    assert.equal(await evaluate("document.querySelector('.model-picker [aria-selected=true] .model-picker__name').textContent"), 'Beta');
    assert.equal(requests, 1, 'Opening the picker again uses the cached catalog');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('.model-picker').matches(':popover-open')");
    assert.ok(await evaluate("document.activeElement === document.querySelector('.composer-settings__model')"));
    for (const [width, zoom] of [[1200, 0], [840, 2]]) {
      window.setSize(width, 620);
      window.webContents.setZoomLevel(zoom);
      await delay(100);
      await evaluate("document.querySelector('.composer-settings__model').click()");
      await wait("document.querySelector('.model-picker').matches(':popover-open') && getComputedStyle(document.querySelector('.model-picker')).visibility === 'visible'");
      const rects = await evaluate(`(() => {
        const popup = document.querySelector('.model-picker').getBoundingClientRect();
        const logo = document.querySelector('.model-picker__provider').getBoundingClientRect();
        const search = document.querySelector('.model-picker__search').getBoundingClientRect();
        return { left: popup.left, top: popup.top, right: popup.right, bottom: popup.bottom, width: innerWidth, height: innerHeight, logoRight: logo.right, searchLeft: search.left };
      })()`);
      assert.ok(rects.left >= 0 && rects.top >= 0 && rects.right <= rects.width + 1 && rects.bottom <= rects.height + 1, JSON.stringify(rects));
      assert.ok(rects.logoRight <= rects.searchLeft + 1, 'Provider is left of search');
      // A genuine outside pointer press exercises native light dismissal.
      const point = await evaluate("(() => { const r = document.querySelector('textarea').getBoundingClientRect(); return { x: r.right - 12, y: r.bottom - 8 }; })()");
      const factor = window.webContents.getZoomFactor();
      const position = { x: Math.round(point.x * factor), y: Math.round(point.y * factor), button: 'left', clickCount: 1 };
      window.webContents.sendInputEvent({ type: 'mouseDown', ...position });
      window.webContents.sendInputEvent({ type: 'mouseUp', ...position });
      await wait("!document.querySelector('.model-picker').matches(':popover-open')");
    }
    assert.equal(requests, 1, 'Browsing uses the cached catalog without extra requests');
    await window.webContents.reload();
    await wait("document.querySelector('.composer-settings__label')?.textContent === 'Beta' && document.querySelector('.composer-settings__thinking')?.textContent.includes('Low')");
    assert.ok(await evaluate("document.querySelector('.composer-settings__thinking').textContent.includes('Fast')"));
    await pointer('.composer-settings__thinking', true);
    await wait("document.querySelector('.thinking-picker').matches(':popover-open')");
    assert.equal(await evaluate("document.querySelector('.thinking-picker__fast').getAttribute('aria-checked')"), 'true');
    assert.ok(await evaluate(`(() => {
      const r = document.querySelector('.thinking-picker').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    })()`));
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('.thinking-picker').matches(':popover-open')");
    assert.ok(await evaluate("document.activeElement === document.querySelector('.composer-settings__thinking')"));
  } finally { window.destroy(); abort.abort(); await running; }
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
