import assert from 'node:assert/strict';
import { captureUI } from './captureUI.mjs';

const input = '.composer__input';
const keys = { Enter: [13, '\r'], Escape: [27], ArrowDown: [40], Backspace: [8] };
async function press(driver, key) {
  const [code, text] = keys[key];
  await driver.window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
  await driver.window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
  await driver.settle();
}
const typeText = (driver, text) => driver.window.webContents.debugger.sendCommand('Input.insertText', { text });
const value = driver => driver.evaluate(`document.querySelector('${input}').value`);

/** Types `@`, picks a project file from the menu and checks the chip, the stored link and Escape dismissal. */
export async function checkMentions(driver) {
  const { evaluate, wait, set } = driver;
  await set(input, 'Look at @mini');
  await wait("[...document.querySelectorAll('.mention-menu [role=option]')].some(option => option.title === 'minified.ts')");
  assert.deepEqual(await evaluate(`(() => { const option = [...document.querySelectorAll('.mention-menu [role=option]')].find(option => option.title === 'minified.ts');
    return { icon: option.querySelector('.file-icon')?.dataset.fileIcon, selected: option.getAttribute('aria-selected'), announced: document.querySelector('${input}').getAttribute('aria-activedescendant') === option.id, combobox: document.querySelector('${input}').getAttribute('role') }; })()`),
    { icon: 'typescript', selected: 'true', announced: true, combobox: 'combobox' }, 'the best match is highlighted and announced');
  await captureUI(driver, 'mention-menu');
  await press(driver, 'Enter');
  await wait(`!document.querySelector('.mention-menu') && !!document.querySelector('${input} .file-mention')`);
  assert.equal(await value(driver), 'Look at [minified.ts](minified.ts) ', 'Enter inserts the chip, stored as a file link, plus one space');
  assert.deepEqual(await evaluate(`(() => { const chip = document.querySelector('${input} .file-mention'); return { name: chip.textContent, title: chip.title, icon: chip.querySelector('.file-icon').dataset.fileIcon }; })()`),
    { name: 'minified.ts', title: 'minified.ts', icon: 'typescript' });
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await typeText(driver, '@bas');
  await wait("[...document.querySelectorAll('.mention-menu [role=option]')].some(option => option.title === 'base.ts')");
  await press(driver, 'Escape');
  await wait("!document.querySelector('.mention-menu')");
  await typeText(driver, 'e');
  await driver.settle();
  assert.equal(await evaluate("!!document.querySelector('.mention-menu')"), false, 'Escape keeps the menu closed while the caret stays in that token');
  assert.equal(await value(driver), 'Look at [minified.ts](minified.ts) @base');
  await typeText(driver, ' and @zzzznomatch');
  await wait("document.querySelector('.mention-menu [role=status]')?.textContent === 'No matching files or folders.'");
  await press(driver, 'Backspace');
  await captureUI(driver, 'mention-chip');
  await evaluate(`(() => { const element = document.querySelector('${input}'); element.focus(); getSelection().selectAllChildren(element); document.execCommand('delete'); })()`);
  await wait(`document.querySelector('${input}').value === '' && !document.querySelector('.mention-menu')`);
}
