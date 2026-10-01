import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkSidebarRestore({ evaluate, send }) {
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const viewport = async (width) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await settle();
  };
  await viewport(2000);
  await evaluate(`document.querySelector('.sidebar__resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))`);
  await settle();
  await evaluate("document.querySelector('.sidebar__resize').focus(); document.querySelector('.sidebar__resize').blur()");
  const saved = await evaluate("Number(localStorage.getItem('flame.sidebar.width'))");
  assert.ok(saved > 208);
  await viewport(1400);
  await evaluate('window.__beforeSidebarReload = true');
  await send('Page.reload');
  let loaded = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      loaded = await evaluate("!window.__beforeSidebarReload && document.readyState === 'complete' && !!document.querySelector('.sidebar__resize')");
    } catch {
      // The renderer execution context can disappear during reload.
    }
    if (loaded) break;
    await delay(30);
  }
  assert.ok(loaded, 'Sidebar must mount after reload');
  await settle();
  assert.equal(await evaluate("Number(document.querySelector('.sidebar__resize').getAttribute('aria-valuenow'))"), 208);
  await viewport(2000);
  assert.equal(await evaluate("Number(document.querySelector('.sidebar__resize').getAttribute('aria-valuenow'))"), saved);
  assert.equal(await evaluate("Number(localStorage.getItem('flame.sidebar.width'))"), saved);
  // Leave room for the composer checks that follow.
  await evaluate(`document.querySelector('.sidebar__resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))`);
  await settle();
}
