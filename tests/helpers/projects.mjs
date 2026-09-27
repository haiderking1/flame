import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkProjects({ evaluate, send, folder }) {
  await send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false });
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
    assert.fail(`Timed out: ${expression}. UI: ${await evaluate('document.body.innerText')}`);
  };
  await evaluate(`(() => { const toggle = document.querySelector('.app-shell > .sidebar-toggle'); if (toggle.getAttribute('aria-expanded') === 'false') toggle.click(); })()`);
  await wait("document.querySelector('.sidebar-threads__empty')?.textContent.includes('No projects yet')");
  const open = async () => {
    await evaluate("(document.querySelector('.sidebar-threads__empty button') ?? document.querySelector('[aria-label=\"New project\"]')).click()");
    await wait("document.querySelector('.project-picker')?.open");
    await evaluate("document.querySelector('.project-picker__source').click()");
    await wait("document.querySelector('[aria-label=\"Folder path\"]') !== null");
    assert.ok(await evaluate(`(() => {
      const popup = document.querySelector('.project-picker__surface').getBoundingClientRect();
      const header = document.querySelector('.project-picker__header').getBoundingClientRect();
      return Math.abs(popup.top - innerHeight * .1) < 1 && Math.abs(popup.width - 576) < 1 &&
        popup.height <= 420.5 && Math.abs(header.height - 48) < 1 &&
        Math.abs(popup.left + popup.width / 2 - innerWidth / 2) < 1;
    })()`), 'Project picker must use the measured top-aligned shell and header geometry');
  };
  const path = async (value) => {
    await evaluate(`(() => { const input = document.querySelector('[aria-label="Folder path"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  };
  await open();
  await path(`${folder}/does-not-exist/`);
  await wait("document.querySelector('.project-picker [role=alert]')?.textContent.includes('no longer exists')");
  await path(`${folder}/`);
  await wait("document.querySelector('.project-picker [role=option] button')?.textContent.includes('child')");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await wait("document.querySelector('[aria-label=\"Folder path\"]').value === '~/folders/child/'");
  await wait("document.querySelector('.project-picker__body')?.textContent.includes('No visible subfolders')");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))");
  await wait("document.querySelector('[aria-label=\"Folder path\"]').value === '~/folders/'");
  await wait("document.querySelector('.project-picker [role=option] button')?.textContent.includes('child')");
  await evaluate("document.querySelector('.project-picker [role=option] button').click()");
  await wait("document.querySelector('[aria-label=\"Folder path\"]').value === '~/folders/child/'");
  await wait("document.querySelector('.project-picker__body')?.textContent.includes('No visible subfolders')");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))");
  await wait("!document.querySelector('.project-picker')");
  await wait("document.querySelector('.project-filter [role=option][title]')?.title.endsWith('/child')");
  assert.equal(await evaluate("document.querySelector('.sidebar-threads__empty').textContent"), 'No threads yet');
  assert.equal(await evaluate("document.querySelector('.project-list')"), null);
  const newProject = await evaluate(`(() => {
    const bounds = document.querySelector('[aria-label="New project"]').getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...newProject });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.deepEqual(await evaluate(`(() => {
    const button = document.querySelector('[aria-label="New project"]');
    return { hovered: button.matches(':hover'), background: getComputedStyle(button).backgroundColor,
      cursor: getComputedStyle(button).cursor, icon: getComputedStyle(button.querySelector('svg')).color };
  })()`), { hovered: true, background: 'rgba(255, 255, 255, 0.04)', cursor: 'pointer', icon: 'rgb(245, 245, 245)' });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 100 });
  // Re-adding the same directory selects the existing project, never duplicates it.
  await open();
  await path(`${folder}/child/`);
  await wait("document.querySelector('.project-picker__body')?.textContent.includes('No visible subfolders')");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))");
  await wait("!document.querySelector('.project-picker')");
  assert.equal(await evaluate("document.querySelectorAll('.project-filter [role=option][title]').length"), 1);
  await evaluate('window.__beforeProjectReload = true');
  await send('Page.reload');
  await wait("!window.__beforeProjectReload && document.readyState === 'complete' && document.querySelector('.app-shell > .sidebar-toggle') !== null");
  await evaluate(`(() => { const toggle = document.querySelector('.app-shell > .sidebar-toggle'); if (toggle.getAttribute('aria-expanded') === 'false') toggle.click(); })()`);
  await wait("document.querySelector('.project-filter [role=option][title]')?.title.endsWith('/child')");
  // Real Escape cancellation restores focus to the triggering control.
  await evaluate("document.querySelector('[aria-label=\"New project\"]').focus()");
  await open();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('.project-picker')");
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'New project');
}
