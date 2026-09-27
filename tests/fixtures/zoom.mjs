import assert from 'node:assert/strict';
import { app, Menu } from 'electron';
import { createWindow } from '../../dist/main/window.js';
import { installApplicationMenu } from '../../dist/main/applicationMenu.js';
import { zoomWindow } from '../../dist/main/windowZoom.js';

void app.whenReady().then(async () => {
  installApplicationMenu();
  const window = await createWindow();
  const contents = window.webContents;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} should equal ${expected}`);
  if (process.argv.includes('--verify-restored')) {
    near(contents.getZoomLevel(), 1.5);
  } else {
    near(contents.getZoomLevel(), 3);
    const menu = Menu.getApplicationMenu();
    for (const [id, accelerator] of [['zoom-in', 'CmdOrCtrl+='], ['zoom-plus', 'CmdOrCtrl+Plus'], ['zoom-out', 'CmdOrCtrl+-'], ['zoom-reset', 'CmdOrCtrl+0']]) {
      assert.equal(menu.getMenuItemById(id).accelerator, accelerator);
    }
    await zoomWindow(window, 'reset');
    near(contents.getZoomLevel(), 0);
    await zoomWindow(window, 'in');
    near(contents.getZoomLevel(), 0.5);
    await zoomWindow(window, 'out');
    near(contents.getZoomLevel(), 0);
    for (let i = 0; i < 3; i++) await zoomWindow(window, 'in');
    near(contents.getZoomLevel(), 1.5);
    if (process.platform === 'linux') {
      const height = await contents.executeJavaScript("document.querySelector('.window-titlebar').getBoundingClientRect().height");
      assert.ok(Math.abs(height * contents.getZoomFactor() - 40) < 1);
    }
    await zoomWindow(null, 'in');
  }
  window.destroy();
  await zoomWindow(window, 'in');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
