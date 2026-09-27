import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkSettings({ evaluate, send, savedAuthPath }) {
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(30); }
    assert.fail(`Timed out: ${expression}`);
  };
  const toggleSidebar = () => evaluate(`(() => { const toggle = document.querySelector('.app-shell > .sidebar-toggle'); if (toggle.getAttribute('aria-expanded') === 'false') toggle.click(); })()`);
  const setDraft = (text) => evaluate(`(() => {
    const input = document.querySelector('.workspace textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const original = await evaluate("document.querySelector('.workspace textarea').value");
  await setDraft('Keep this draft while visiting settings');
  await toggleSidebar();
  assert.ok(await evaluate(`(() => {
    const footer = document.querySelector('.sidebar-footer').getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    return Math.abs(footer.bottom - sidebar.bottom) < 1;
  })()`), 'Settings belongs at the bottom of the sidebar');
  await evaluate("document.querySelector('[aria-label=\"Settings\"]').click()");
  await wait("document.querySelector('.settings-page') !== null");
  await wait("document.querySelector('.provider-row__switch')?.disabled === false");
  if (savedAuthPath) {
    assert.ok(await evaluate(`(() => {
      const dot = document.querySelector('.provider-connection-status');
      return document.querySelector('.provider-row__switch').getAttribute('aria-checked') === 'true' &&
        getComputedStyle(dot).backgroundColor === 'rgb(74, 222, 128)' && dot.getAttribute('aria-label') === 'Connected' &&
        document.querySelector('#codex-auth-description').textContent === 'Connected · test@example.com · plus' &&
        !document.body.textContent.includes('fake-access-token');
    })()`), 'Saved authentication renders immediately through RPC without a loading screen');
    const emailState = () => evaluate(`(() => {
      const button = document.querySelector('.private-email');
      return { blur: getComputedStyle(button.querySelector('span')).filter, label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed') };
    })()`);
    assert.deepEqual(await emailState(), { blur: 'blur(4px)', label: 'Reveal email address', pressed: 'false' });
    await evaluate("document.querySelector('.private-email').click()");
    await wait("document.querySelector('.private-email').dataset.revealed === 'true'");
    assert.deepEqual(await emailState(), { blur: 'none', label: 'Hide email address: test@example.com', pressed: 'true' });
    await evaluate("document.querySelector('.private-email').click()");
    await wait("document.querySelector('.private-email').dataset.revealed === 'false'");
    assert.equal((await emailState()).blur, 'blur(4px)');
    await evaluate("document.querySelector('.private-email').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await wait("document.querySelector('.private-email').dataset.revealed === 'true'");
    await evaluate("document.querySelector('[aria-label=\"Close settings\"]').click()");
    await wait("!document.querySelector('.settings-page')");
    await evaluate("document.querySelector('[aria-label=\"Settings\"]').click()");
    await wait("document.querySelector('.private-email') !== null");
    assert.equal((await emailState()).blur, 'blur(4px)', 'Email must hide again when reopening settings');
    await evaluate("document.querySelector('[aria-label=\"Sign out of OpenAI\"]').click()");
    await wait("document.querySelector('.provider-row__switch')?.getAttribute('aria-checked') === 'false' && !document.querySelector('.provider-row__switch').disabled");
    assert.deepEqual(JSON.parse(await readFile(savedAuthPath, 'utf8')), { other: { preserved: true } });
  }
  assert.ok(await evaluate(`(() => {
    const workspace = document.querySelector('.workspace');
    const page = document.querySelector('.settings-page');
    const toggle = page.querySelector('[role=switch]');
    const logo = page.querySelector('img');
    return getComputedStyle(workspace).display === 'none' && !page.closest('dialog') &&
      document.querySelector('.settings-navigation [aria-current=page]').textContent === 'Providers' &&
      !document.querySelector('.sidebar-toolbar') && !toggle.disabled && toggle.getAttribute('aria-checked') === 'false' &&
      toggle.getAttribute('aria-label') === 'Sign in with OpenAI' &&
      page.querySelector('h2').textContent === 'Codex' && !logo.src.startsWith('https:');
  })()`));
  await wait("document.querySelector('.provider-row img').complete && document.querySelector('.provider-row img').naturalWidth > 0");
  assert.ok(await evaluate(`(() => {
    const dot = document.querySelector('.provider-connection-status');
    const bounds = dot.getBoundingClientRect();
    const logo = document.querySelector('.provider-row__logo').getBoundingClientRect();
    return dot.getAttribute('aria-label') === 'Not connected' &&
      getComputedStyle(dot).backgroundColor === 'rgb(239, 100, 100)' &&
      Math.abs(bounds.top - logo.top + 1) < 1 && Math.abs(logo.right - bounds.right + 1) < 1;
  })()`), 'Disconnected provider must show an accessible red dot on the logo’s top-right corner');
  await evaluate("document.querySelector('[aria-label=\"Close settings\"]').click()");
  await wait("!document.querySelector('.settings-page')");
  assert.equal(await evaluate("document.querySelector('.workspace textarea').value"), 'Keep this draft while visiting settings');
  await evaluate("document.querySelector('[aria-label=\"Settings\"]').click()");
  await wait("document.querySelector('.settings-page') !== null");
  await evaluate("document.querySelector('[aria-label=\"Back to workspace\"]').click()");
  await wait("!document.querySelector('.settings-page')");
  await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait("document.querySelector('.sidebar-drawer') !== null");
  await toggleSidebar();
  await wait("document.querySelector('.sidebar-drawer').open");
  await evaluate("document.querySelector('[aria-label=\"Settings\"]').click()");
  await wait("document.querySelector('.settings-page') && !document.querySelector('.sidebar-drawer').open");
  assert.ok(await evaluate(`(() => {
    const page = document.querySelector('.settings-page');
    const content = document.querySelector('.settings-page__content');
    return page.getBoundingClientRect().right <= innerWidth + 1 && content.scrollWidth <= content.clientWidth;
  })()`), `Settings must fit the narrow viewport without horizontal overflow: ${await evaluate(`JSON.stringify({ viewport: innerWidth, right: document.querySelector('.settings-page').getBoundingClientRect().right, scroll: document.querySelector('.settings-page__content').scrollWidth, width: document.querySelector('.settings-page__content').clientWidth })`)}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('.settings-page')");
  assert.equal(await evaluate("document.querySelector('.workspace textarea').value"), 'Keep this draft while visiting settings');
  await send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false });
  await wait("document.querySelector('.sidebar__resize') !== null");
  await toggleSidebar();
  await setDraft(original);
}
