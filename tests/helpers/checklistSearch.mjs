import { captureUI } from './captureUI.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
export async function checkSearch(driver, project, measurements) {
  const { evaluate, wait, click, set } = driver;
  await click('.composer-settings__model'); await wait("document.querySelector('.model-picker').matches(':popover-open')");
  await wait("document.querySelectorAll('.model-picker__option').length > 0 && document.activeElement?.matches('[aria-label=\"Search models\"]')");
  await captureUI(driver, 'model-picker');
  assert.ok(await evaluate("document.querySelectorAll('.model-picker__option').length < 40"), 'large model catalogs are windowed');
  measurements.searchInputLatenciesMs = [await set('[aria-label="Search models"]', 'Model 199')]; await wait("document.querySelectorAll('.model-picker__option').length === 1 && document.querySelector('.model-picker__name')?.textContent === 'Model 199'");
  measurements.searchInputLatenciesMs.push(await set('[aria-label="Search models"]', '')); await wait("!!document.querySelector('.model-picker [data-virtual-options=true]')");
  await evaluate("document.querySelector('[aria-label=\"Search models\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); true");
  await wait("document.querySelector('[data-highlighted=true] .model-picker__name')?.textContent === 'Model 199'");
  await evaluate("document.querySelector('[aria-label=\"Search models\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true");
  const folders = join(project.path,'browse'); await mkdir(folders);
  await Promise.all(Array.from({length:220}, (_,index) => mkdir(join(folders,`folder-${String(index).padStart(3,'0')}`))));
  await click('[aria-label="New project"]'); await wait("!!document.querySelector('.project-picker')");
  await evaluate("[...document.querySelectorAll('.project-picker button')].find(button => button.textContent.includes('Local folder')).click()");
  await wait("!!document.querySelector('[aria-label=\"Folder path\"]')");
  // The final path is valid; intermediate paths must never become selectable stale results.
  measurements.searchInputLatenciesMs.push(await set('[aria-label="Folder path"]', `${folders}/missing/`), await set('[aria-label="Folder path"]', `${folders}/`));
  await wait("document.querySelector('#folder-options [data-virtual-options=true]') !== null && !document.querySelector('.project-picker__body').getAttribute('aria-busy').includes('true')");
  assert.ok(await evaluate("document.querySelectorAll('#folder-options [role=option]').length < 40"));
  measurements.searchInputLatenciesMs.push(await set('[aria-label="Folder path"]', `${folders}/folder-219`)); await wait("document.querySelectorAll('#folder-options [role=option]').length === 1 && document.querySelector('#folder-options [role=option]').textContent.includes('folder-219')");
  measurements.searchInputLatenciesMs.push(await set('[aria-label="Folder path"]', `${folders}/`)); await wait("!!document.querySelector('#folder-options [data-virtual-options=true]')");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); true");
  await wait("document.querySelector('#folder-option-1')?.getAttribute('aria-selected') === 'true'");
  await evaluate("document.querySelector('[aria-label=\"Folder path\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); true");
  await click('[aria-label="Close project picker"]'); await wait("!document.querySelector('.project-picker')");
}
