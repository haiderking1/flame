import assert from 'node:assert/strict';
import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { appIcon } from '../../dist/main/appIcon.js';

const header = url => { const png = readFileSync(url); return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] }; };
void app.whenReady().then(() => {
  const icon = appIcon();
  assert.equal(icon.isEmpty(), false, 'Electron loads the icon');
  assert.deepEqual(icon.getSize(), { width: 512, height: 512 });
  assert.equal(appIcon(), icon, 'loaded once');
  // A corner is transparent: the tile sits inside the canvas with room for its shadow.
  assert.equal(icon.toBitmap()[3], 0);
  assert.deepEqual(header(new URL('../../resources/icons/flame-1024.png', import.meta.url)), { width: 1024, height: 1024, colorType: 6 });
  console.log('FLAME_APP_ICON_OK');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
