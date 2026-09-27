import assert from 'node:assert/strict';

export async function checkTitlebar(evaluate) {
  const geometry = await evaluate(`(() => {
    const overlay = navigator.windowControlsOverlay;
    const header = document.querySelector('.window-titlebar');
    const bounds = header.getBoundingClientRect();
    const rect = overlay?.getTitlebarAreaRect();
    const actions = document.querySelector('.workspace-actions nav').getBoundingClientRect();
    return { visible: overlay?.visible ?? false,
      active: document.documentElement.classList.contains('native-titlebar'),
      height: bounds.height, nativeHeight: rect?.height,
      actionsRight: actions.right, nativeRight: rect?.right,
      draggable: getComputedStyle(header).getPropertyValue('-webkit-app-region'),
      controlsDraggable: getComputedStyle(document.querySelector('.workspace-actions nav')).getPropertyValue('-webkit-app-region') };
  })()`);
  assert.equal(geometry.draggable, 'drag');
  assert.equal(geometry.controlsDraggable, 'no-drag');
  if (process.platform === 'linux') {
    assert.equal(geometry.visible, false, 'Window manager owns Linux window controls');
    assert.equal(geometry.active, false);
    assert.ok(Math.abs(geometry.height - 40 / (1.2 ** 3)) < 1, 'Frameless header must preserve its previous height');
  } else if (process.platform !== 'darwin') {
    assert.equal(geometry.visible, true, 'Native window controls overlay should be enabled');
    assert.equal(geometry.active, true);
    assert.ok(Math.abs(geometry.height - geometry.nativeHeight) < 1, 'Header should track native overlay geometry');
    assert.ok(geometry.actionsRight <= geometry.nativeRight, 'Workspace actions must clear native window controls');
  }
}
