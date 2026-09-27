import assert from "node:assert/strict";
import test from "node:test";
import { loadSidebarWidth, saveSidebarWidth, sidebarMaximumWidth } from "../src/renderer/components/sidebar/sidebarWidth.ts";

test('sidebar width defaults, persistence, validation, and unavailable storage', (t) => {
  let value = null;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: () => value,
      setItem: (_key, next) => { value = next; },
    },
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete globalThis.window;
  });
  assert.equal(loadSidebarWidth(), 256);
  saveSidebarWidth(350);
  assert.equal(loadSidebarWidth(), 350);
  assert.equal(sidebarMaximumWidth(900), 260);
  assert.equal(sidebarMaximumWidth(700), 208);
  assert.equal(loadSidebarWidth(), 350); // Keep preference separate from display limits.
  assert.equal(value, '350');
  for (const invalid of ['oops', 'null', '"350"', '{}', '1e999']) {
    value = invalid;
    assert.equal(loadSidebarWidth(), 256);
  }
  value = '100';
  assert.equal(loadSidebarWidth(), 208);
  saveSidebarWidth(300);
  for (const invalid of [NaN, Infinity, -1]) saveSidebarWidth(invalid);
  assert.equal(value, '300');
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('unavailable'); } });
  assert.equal(loadSidebarWidth(), 256);
  assert.doesNotThrow(() => saveSidebarWidth(300));
});
