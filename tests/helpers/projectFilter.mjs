import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkProjectFilter({ evaluate, send, folder }) {
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
    assert.fail(`Timed out: ${expression}`);
  };
  const type = (label, text) => evaluate(`(() => {
    const input = document.querySelector('[aria-label="${label}"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const key = async (key, code) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
  };
  // Add a second project so filtering can be distinguished from selection alone.
  await evaluate("document.querySelector('[aria-label=\"New project\"]').click()");
  await wait("document.querySelector('.project-picker__source') !== null");
  await evaluate("document.querySelector('.project-picker__source').click()");
  await wait("document.querySelector('[aria-label=\"Folder path\"]') !== null");
  await type('Folder path', `${folder}/`);
  await wait("document.querySelector('.project-picker [role=option] button')?.textContent.includes('child')");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))");
  await wait("!document.querySelector('.project-picker') && document.querySelectorAll('.project-filter [role=option][title]').length === 2");
  const open = async () => {
    await evaluate("document.querySelector('[aria-label^=\"Filter threads by project\"]').click()");
    await wait("document.querySelector('.project-filter').matches(':popover-open') && document.activeElement?.getAttribute('aria-label') === 'Search projects'");
  };
  await open();
  assert.ok(await evaluate(`(() => {
    const rect = document.querySelector('.project-filter').getBoundingClientRect();
    const anchor = document.querySelector('.sidebar-toolbar__search').getBoundingClientRect();
    return Math.abs(rect.left - anchor.left) < 1 && Math.abs(rect.top - anchor.bottom - 4) < 1 &&
      rect.width >= anchor.width && rect.width <= 288 && rect.right <= innerWidth;
  })()`), 'Dropdown must anchor below the search field, not the icon');
  await type('Search projects', 'no-such-project');
  await wait("document.querySelector('.project-filter__status')?.textContent === 'No matching projects.'");
  await type('Search projects', 'CHILD');
  await wait("document.querySelectorAll('.project-filter [role=option]').length === 1");
  await key('Enter', 13);
  await wait("!document.querySelector('.project-filter').matches(':popover-open') && document.querySelector('.sidebar-threads__empty').textContent === 'No threads in child yet'");
  assert.equal(await evaluate("document.querySelector('.project-list')"), null);
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'Filter threads by project: child');
  assert.equal(await evaluate("document.querySelector('[aria-label^=\"Filter threads by project\"] .project-icon')?.textContent"), 'CD');
  await evaluate('window.__beforeScopeReload = true');
  await send('Page.reload');
  await wait("!window.__beforeScopeReload && document.querySelector('.sidebar-threads__empty')?.textContent === 'No threads in child yet'");
  await evaluate(`(() => { const toggle = document.querySelector('.app-shell > .sidebar-toggle'); if (toggle.getAttribute('aria-expanded') === 'false') toggle.click(); })()`);
  await open();
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Search projects\"]').value"), '');
  assert.equal(await evaluate("[...document.querySelectorAll('.project-filter__settings')].every(button => button.disabled)"), true);
  await type('Search projects', 'All projects');
  await wait("document.querySelectorAll('.project-filter [role=option]').length === 0");
  await type('Search projects', '');
  await key('Enter', 13);
  await wait("document.querySelector('.sidebar-threads__empty').textContent === 'No threads yet'");
  await open();
  await key('ArrowDown', 40);
  assert.ok(await evaluate("document.querySelector('[aria-label=\"Search projects\"]').getAttribute('aria-activedescendant').endsWith('-option-1')"));
  await key('Escape', 27);
  await wait("!document.querySelector('.project-filter').matches(':popover-open')");
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'Filter threads by project');
  await open();
  const click = async (point) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  await click(await evaluate(`(() => {
    const rect = document.querySelector('[aria-label="Filter threads by project"]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`));
  await wait("!document.querySelector('.project-filter').matches(':popover-open')");
  await open();
  await click(await evaluate('({ x: innerWidth - 10, y: 100 })'));
  await wait("!document.querySelector('.project-filter').matches(':popover-open')");
  // The popup remains bounded inside the mobile drawer, and Escape closes only the popup.
  await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait("document.querySelector('.sidebar-drawer')?.open && !document.querySelector('.sidebar__resize')");
  await open();
  assert.ok(await evaluate(`(() => {
    const rect = document.querySelector('.project-filter').getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  })()`));
  await key('Escape', 27);
  await wait("!document.querySelector('.project-filter').matches(':popover-open')");
  assert.equal(await evaluate("document.querySelector('.app-shell > .sidebar-toggle').getAttribute('aria-expanded')"), 'true');
  await send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false });
  await wait("document.querySelector('.sidebar__resize') !== null");
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate("localStorage.setItem('flame.sidebar.projectScope', 'missing-project'); window.__beforeScopeReload = true");
  await send('Page.reload');
  await wait("!window.__beforeScopeReload && document.querySelector('.sidebar-threads__empty')?.textContent === 'No threads yet' && localStorage.getItem('flame.sidebar.projectScope') === null");
}
