import assert from 'node:assert/strict';

export async function checkResponsive({ evaluate, send }) {
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const viewport = async (width) => {
    await send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(width * 1.728), height: 1400, deviceScaleFactor: 1, mobile: false });
    await settle();
    assert.ok(Math.abs(await evaluate('innerWidth') - width) <= 2);
  };
  const toggle = "document.querySelector('.app-shell > .sidebar-toggle')";
  await viewport(1200);
  const desktopWidth = await evaluate("document.querySelector('#workspace-sidebar').getBoundingClientRect().width");
  assert.equal(await evaluate("Math.round(document.querySelector('.workspace__composer').getBoundingClientRect().width)"), 736);
  await viewport(750);
  assert.equal(await evaluate("document.querySelector('.sidebar-drawer').open"), false);
  assert.equal(await evaluate("document.querySelector('.workspace').getBoundingClientRect().left"), 0);
  await evaluate(`${toggle}.focus(); ${toggle}.click()`);
  await settle();
  assert.ok(await evaluate(`(() => {
    const drawer = document.querySelector('.sidebar-drawer');
    return drawer.open && drawer.contains(document.activeElement) &&
      !drawer.querySelector('[role=separator]') &&
      Math.abs(drawer.getBoundingClientRect().width - (innerWidth - 12)) < 1;
  })()`), 'Mobile sidebar should be a focus-contained, non-resizable overlay');
  await evaluate("document.querySelector('.sidebar-drawer').dispatchEvent(new Event('cancel', { cancelable: true }))");
  await settle();
  assert.equal(await evaluate("document.querySelector('.sidebar-drawer').open"), false);
  assert.equal(await evaluate(`document.activeElement === ${toggle}`), true);
  await viewport(1200);
  assert.ok(Math.abs(await evaluate("document.querySelector('#workspace-sidebar').getBoundingClientRect().width") - desktopWidth) < 1);

  for (const [width, padding] of [[630, '12px'], [650, '20px']]) {
    await viewport(width);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.workspace__chat')).paddingLeft"), padding);
  }
  for (const [width, sheet] of [[990, false], [970, true], [750, true], [320, true]]) {
    await viewport(width);
    await evaluate("document.querySelector('[aria-controls=workspace-diff]').click()");
    await settle();
    assert.equal(await evaluate("Boolean(document.querySelector('.diff-sheet')?.open)"), sheet);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'Responsive layout must not overflow');
    if (sheet) {
      assert.ok(await evaluate(`(() => {
        const bounds = document.querySelector('.diff-sheet').getBoundingClientRect();
        const expected = innerWidth <= 760 ? Math.min(innerWidth * .88, 384) : Math.max(320, Math.min(innerWidth * .42, 448));
        return Math.abs(bounds.width - expected) < 1 && Math.abs(bounds.right - innerWidth) < 1;
      })()`));
      await evaluate("document.querySelector('.diff-sheet').dispatchEvent(new Event('cancel', { cancelable: true }))");
    } else {
      await evaluate("document.querySelector('[aria-label=\"Close diff panel\"]').click()");
    }
    await settle();
  }
  await viewport(1200);
  await evaluate("document.querySelector('.workspace__composer').style.width = '300px'");
  await settle();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.composer-settings__model .composer-settings__label')).display"), 'none');
  assert.ok(await evaluate("document.querySelector('.composer').scrollWidth <= document.querySelector('.composer').clientWidth + 1"));
  await evaluate("document.querySelector('.workspace__composer').style.removeProperty('width')");
  await settle();
}
