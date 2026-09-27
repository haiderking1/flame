import assert from 'node:assert/strict';

export async function checkResponsive({ evaluate, send }) {
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const viewport = async (width, height = 810) => {
    await send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(width * 1.728), height: Math.ceil(height * 1.728), deviceScaleFactor: 1, mobile: false });
    await settle();
    assert.ok(Math.abs(await evaluate('innerWidth') - width) <= 2);
  };
  const toggle = "document.querySelector('.app-shell > .sidebar-toggle')";
  await viewport(1200);
  const desktopWidth = await evaluate("document.querySelector('#workspace-sidebar').getBoundingClientRect().width");
  await evaluate(`${toggle}.click()`);
  await settle();
  for (const width of [750, 1200, 600, 1200]) {
    await viewport(width);
    assert.equal(await evaluate(`${toggle}.getAttribute('aria-expanded')`), 'false', 'Resizing must preserve a collapsed sidebar');
    assert.equal(await evaluate("document.querySelector('#workspace-sidebar').getBoundingClientRect().width"), 0);
  }
  let drawerNaturalWidth;
  for (const width of [750, 600, 486, 320, 208]) {
    await viewport(width);
    await evaluate(`${toggle}.click()`);
    await settle();
    const drawerWidth = await evaluate("document.querySelector('.sidebar-drawer').getBoundingClientRect().width");
    if (drawerNaturalWidth === undefined) {
      drawerNaturalWidth = drawerWidth;
      assert.ok(drawerWidth >= 280 && drawerWidth <= 380, `Drawer should be content-sized, not viewport-wide: ${drawerWidth}`);
    }
    assert.ok(Math.abs(drawerWidth - Math.min(drawerNaturalWidth, await evaluate('innerWidth - 12'))) < 1,
      `Drawer must retain its natural width and only shrink to fit at ${width}px`);
    assert.ok(await evaluate(`(() => {
      const drawer = document.querySelector('.sidebar-drawer').getBoundingClientRect();
      const sidebar = document.querySelector('#workspace-sidebar').getBoundingClientRect();
      const toolbar = document.querySelector('.sidebar-toolbar').getBoundingClientRect();
      const actions = document.querySelector('.sidebar-toolbar__actions').getBoundingClientRect();
      const input = document.querySelector('.sidebar-toolbar__search input').getBoundingClientRect();
      const header = document.querySelector('.sidebar__header').getBoundingClientRect();
      return Math.abs(sidebar.top - drawer.top) < 1 &&
        Math.abs(sidebar.bottom - drawer.bottom) < 1 &&
        Math.abs(toolbar.top - header.bottom) < 1 &&
        actions.right <= drawer.right && input.right <= actions.left &&
        !document.querySelector('.sidebar-brand') &&
        document.querySelector('.sidebar-drawer').scrollHeight <= innerHeight + 1;
    })()`), `Drawer header, search, and actions must fit at ${width}px`);
    await evaluate("document.querySelector('.sidebar-drawer').dispatchEvent(new Event('cancel', { cancelable: true }))");
    await settle();
  }
  await viewport(1200);
  assert.equal(await evaluate(`${toggle}.getAttribute('aria-expanded')`), 'false', 'Closing the drawer must also keep the desktop sidebar closed');
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
      drawer.getBoundingClientRect().width < innerWidth * .6;
  })()`), 'Mobile sidebar should be a focus-contained, non-resizable overlay');
  await evaluate("document.querySelector('.sidebar-drawer').dispatchEvent(new Event('cancel', { cancelable: true }))");
  await settle();
  assert.equal(await evaluate("document.querySelector('.sidebar-drawer').open"), false);
  assert.equal(await evaluate(`document.activeElement === ${toggle}`), true);
  await viewport(1200);
  assert.equal(await evaluate(`${toggle}.getAttribute('aria-expanded')`), 'false');
  await evaluate(`${toggle}.click()`);
  await settle();
  assert.ok(Math.abs(await evaluate("document.querySelector('#workspace-sidebar').getBoundingClientRect().width") - desktopWidth) < 1);
  await viewport(750);
  assert.equal(await evaluate("document.querySelector('.sidebar-drawer').open"), true, 'An explicitly opened sidebar stays open across the breakpoint');
  await viewport(1200);
  assert.equal(await evaluate(`${toggle}.getAttribute('aria-expanded')`), 'true');
  await evaluate(`${toggle}.click()`);
  await settle();

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

  // Exercise widths below native window limits too: tiling compositors can
  // override size hints, and browser zoom further reduces the CSS viewport.
  for (const [width, height] of [[486, 359], [240, 600], [127, 588], [240, 150]]) {
    await viewport(width, height);
    assert.ok(await evaluate(`(() => {
      const root = document.documentElement;
      const shell = document.querySelector('.app-shell').getBoundingClientRect();
      const toggle = document.querySelector('.app-shell > .sidebar-toggle svg').getBoundingClientRect();
      return root.scrollWidth <= innerWidth + 1 && root.scrollHeight <= innerHeight + 1 &&
        Math.abs(root.clientWidth - innerWidth) <= 1 && Math.abs(root.clientHeight - innerHeight) <= 1 &&
        Math.abs(shell.height - innerHeight) < 1 && toggle.top >= 0;
    })()`), 'Tiny windows must not scroll the page or displace the titlebar');
    if (height >= 359) {
      assert.ok(await evaluate(`(() => {
        const chat = document.querySelector('.workspace__chat').getBoundingClientRect();
        const composer = document.querySelector('.workspace__composer').getBoundingClientRect();
        return Math.abs((composer.top + composer.bottom) - (chat.top + chat.bottom)) < 2;
      })()`), 'Empty composer must stay vertically centered in the chat');
    }
  }
  await viewport(1200);
}
