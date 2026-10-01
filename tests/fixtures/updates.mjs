import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { DesktopUpdates } from '../../dist/main/updates/desktopUpdates.js';
import { rendererDriver } from '../helpers/rendererDriver.mjs';
import { captureUI } from '../helpers/captureUI.mjs';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  // electron-updater's autoUpdater, answering as the test tells it to.
  const updater = Object.assign(new EventEmitter(), { autoDownload: true, autoInstallOnAppQuit: true, logger: undefined, channel: null, allowPrerelease: false, allowDowngrade: false,
    checks: 0, downloads: 0, installs: [], failNextCheck: false,
    async checkForUpdates() { this.checks++; this.emit('checking-for-update');
      if (this.failNextCheck) { this.failNextCheck = false; throw new Error('getaddrinfo ENOTFOUND github.com'); }
      this.emit('update-available', { version: '9.9.9' }); },
    async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 35 }); await new Promise(resolve => setTimeout(resolve, 150)); this.emit('download-progress', { percent: 100 }); this.emit('update-downloaded', { version: '9.9.9' }); },
    quitAndInstall(...args) { this.installs.push(args); } });
  let prepared = 0;
  const updates = new DesktopUpdates({ updater, disabledReason: null, prepareToInstall: async () => { prepared++; } });
  await updates.start();
  assert.deepEqual([updater.autoDownload, updater.autoInstallOnAppQuit, updater.channel, updater.allowPrerelease], [false, false, 'latest', false], 'downloads and installs wait for the user');

  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename: join(app.getPath('userData'), 'flame.sqlite'), token: 'updates-token', origin: 'file://',
    openBrowser: async () => {}, modelsClient: new CodexModelsClient(async () => Response.json({ models: [] })), ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=updates-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait } = driver;
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const button = "document.querySelector('.sidebar-footer .update-button')";
  try {
    await wait("document.querySelector('.sidebar-footer .sidebar-footer__settings') !== null");
    if (await evaluate("document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === 'false'")) await driver.click('.sidebar-toggle');
    await wait("getComputedStyle(document.querySelector('.sidebar-footer')).visibility === 'visible' && document.querySelector('.sidebar-footer').getBoundingClientRect().width > 100");
    assert.equal(await evaluate(button), null, 'no button until there is an update');

    // A failed check says why, and the button retries it.
    updater.failNextCheck = true;
    await updates.check();
    await wait(`${button}?.getAttribute('aria-label') === 'Update check failed. Click to retry.'`);
    assert.equal(updates.state.message, 'Could not check for updates. Check your connection and try again.');
    await captureUI(driver, 'update-check-failed');

    // The retry finds an update: the sidebar offers it.
    await evaluate(`${button}.click()`);
    await wait(`${button}?.getAttribute('aria-label') === 'Update 9.9.9 ready to download'`);
    await captureUI(driver, 'update-available');
    await evaluate(`${button}.click()`);
    await wait(`${button}?.getAttribute('aria-label') === 'Update 9.9.9 downloaded. Click to restart and install.'`);
    assert.equal(updater.downloads, 1);
    await wait("[...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('Flame 9.9.9 downloaded') && toast.textContent.includes('Restart Flame from the update button'))");
    await new Promise(resolve => setTimeout(resolve, 400));
    await captureUI(driver, 'update-downloaded');

    // Settings → About shows the version and the track, and switching to nightly keeps the downloaded update.
    await evaluate("document.querySelector('.sidebar-footer__settings').click()");
    await evaluate("[...document.querySelectorAll('.settings-navigation button')].find(item => item.textContent === 'About').click()");
    await wait("document.querySelector('#about-heading')?.textContent === 'About'");
    assert.ok((await evaluate("document.querySelector('#about-version-description').textContent")).includes('Flame 9.9.9 is ready to install.'));
    assert.equal(await evaluate("document.querySelector('.about-settings__button').textContent"), 'Install');
    assert.equal(await evaluate("document.querySelector('.about-settings__link').href"), 'https://github.com/haiderking1/flame/releases/tag/v9.9.9');
    await captureUI(driver, 'update-about');
    await updates.setChannel('nightly');
    assert.deepEqual([updater.channel, updater.allowPrerelease, updater.allowDowngrade], ['nightly', true, true]);
    await wait("document.querySelector('#about-track .settings-select')?.textContent.includes('Nightly') ?? document.querySelector('[aria-label=\"Update track\"]')?.textContent.includes('Nightly')");
    assert.equal(await evaluate("document.querySelector('.about-settings__button').textContent"), 'Install', 'the downloaded update stays ready');

    // Installing asks first, then hands over to the updater after the backend stops.
    await evaluate("document.querySelector('.about-settings__button').click()");
    await wait("document.querySelector('.session-dialog')?.open === true");
    assert.equal(await evaluate("document.querySelector('.session-dialog h2').textContent"), 'Install Flame 9.9.9?');
    await captureUI(driver, 'update-install-confirm');
    await evaluate("document.querySelector('.session-dialog button[type=submit]').click()");
    for (let i = 0; i < 100 && !updater.installs.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(prepared, 1);
    assert.deepEqual(updater.installs, [[true, true]]);

    assert.deepEqual(errors, []);
    console.log('FLAME_UPDATES_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'updates-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
