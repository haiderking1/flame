import assert from "node:assert/strict";

export async function checkSidebar({ evaluate, send }) {
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false });
  const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const state = () => evaluate(`(() => {
    const handle = document.querySelector('.sidebar__resize');
    const bounds = handle.getBoundingClientRect();
    return { width: Number(handle.getAttribute('aria-valuenow')),
      min: Number(handle.getAttribute('aria-valuemin')), max: Number(handle.getAttribute('aria-valuemax')),
      x: bounds.x + bounds.width / 2, y: 100 };
  })()`);
  await settle();
  const initial = await state();
  assert.equal(initial.min, 208);
  assert.equal(initial.max, await evaluate('Math.max(208, Math.floor(innerWidth) - 640)'));
  const key = async (key) => {
    await evaluate(`document.querySelector('.sidebar__resize').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }))`);
    await settle();
  };
  await key('Home');
  assert.equal((await state()).width, initial.min);
  assert.ok(await evaluate(`(() => {
    const brand = document.querySelector('.sidebar-brand');
    const bounds = brand.getBoundingClientRect();
    const toggle = document.querySelector('.sidebar-toggle').getBoundingClientRect();
    const header = document.querySelector('.window-titlebar').getBoundingClientRect();
    return brand.textContent === 'Flame' && bounds.left > toggle.right &&
      Math.abs(bounds.top - toggle.top) < 1 && Math.abs(toggle.top + 14 - (header.top + header.height / 2)) < 1 &&
      Math.abs(bounds.left - toggle.right - 11) < 1 &&
      Math.abs(document.querySelector('.sidebar-toolbar__search').getBoundingClientRect().top - header.bottom - 8) < 1 &&
      bounds.right < document.querySelector('.sidebar').getBoundingClientRect().right;
  })()`), 'Flame wordmark should sit beside the collapse button and fit at minimum width');
  assert.deepEqual(await evaluate(`(() => {
    const toolbar = document.querySelector('.sidebar-toolbar');
    const input = toolbar.querySelector('input');
    const buttons = [...toolbar.querySelectorAll('button')];
    return { search: input.placeholder, disabled: input.disabled && buttons.filter(button => button.getAttribute('aria-label') !== 'New project').every(button => button.disabled),
      canAddProject: !buttons.find(button => button.getAttribute('aria-label') === 'New project').disabled,
      labels: buttons.map(button => button.getAttribute('aria-label')),
      fits: toolbar.scrollWidth <= toolbar.clientWidth && input.getBoundingClientRect().width > 40,
      fontSize: getComputedStyle(input).fontSize,
      buttonSize: Math.round(buttons[0].getBoundingClientRect().width) };
  })()`), { search: 'Search', disabled: true, canAddProject: true, labels: ['Select project', 'New project', 'New thread'],
    fits: true, fontSize: '14px', buttonSize: 28 });
  const newProject = await evaluate(`(() => {
    const bounds = document.querySelector('[aria-label="New project"]').getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...newProject });
  await settle();
  assert.deepEqual(await evaluate(`(() => {
    const button = document.querySelector('[aria-label="New project"]');
    return { hovered: button.matches(':hover'), background: getComputedStyle(button).backgroundColor,
      cursor: getComputedStyle(button).cursor, icon: getComputedStyle(button.querySelector('svg')).color };
  })()`), { hovered: true, background: 'rgba(255, 255, 255, 0.04)', cursor: 'pointer', icon: 'rgb(245, 245, 245)' });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 100 });
  await settle();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[aria-label=\"New project\"]')).backgroundColor"), 'rgba(0, 0, 0, 0)');
  await key('ArrowLeft');
  assert.equal((await state()).width, initial.min);
  await key('End');
  assert.equal((await state()).width, initial.max);
  await key('ArrowRight');
  assert.equal((await state()).width, initial.max);

  async function dragTo(delta) {
    const start = await state();
    const x = Math.max(1, Math.min(await evaluate('innerWidth - 1'), start.x + delta));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: start.y, button: 'left', buttons: 1 });
    await settle();
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: start.y, button: 'left', clickCount: 1 });
    await settle();
    assert.equal(await evaluate("document.querySelector('.sidebar').dataset.resizing"), 'false');
  }
  await dragTo(-1000);
  assert.equal((await state()).width, initial.min);
  await dragTo(1000);
  assert.equal((await state()).width, initial.max);
  const resizedWidth = (await state()).width;
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('flame.sidebar.width'))"), resizedWidth);
  await evaluate("document.querySelector('.sidebar-toggle').focus(); document.querySelector('.sidebar-toggle').click()");
  await settle();
  assert.deepEqual(await evaluate(`(() => {
    const button = document.querySelector('.sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    return { expanded: button.getAttribute('aria-expanded'), hidden: sidebar.hidden,
      width: sidebar.getBoundingClientRect().width, focused: document.activeElement === button,
      workspaceLeft: document.querySelector('.workspace').getBoundingClientRect().left };
  })()`), { expanded: 'false', hidden: true, width: 0, focused: true, workspaceLeft: 0 });
  await evaluate("document.querySelector('.sidebar-toggle').click()");
  await settle();
  assert.equal(await evaluate("document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')"), 'true');
  assert.equal(await evaluate("document.querySelector('.sidebar').hidden"), false);
  assert.equal((await state()).width, resizedWidth);
  await dragTo(initial.width - initial.max);
  assert.ok(Math.abs((await state()).width - initial.width) < 1);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1400, deviceScaleFactor: 1, mobile: false });
  await settle();
  assert.equal((await state()).max, 208);
  assert.equal((await state()).width, 208);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 800, deviceScaleFactor: 1, mobile: false });
  await settle();
  assert.equal((await state()).max, await evaluate('Math.max(208, Math.floor(innerWidth) - 640)'));
  await send('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false });
  await settle();
}
