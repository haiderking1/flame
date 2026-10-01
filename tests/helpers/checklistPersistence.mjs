import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
export async function checkPersistence(driver, project, sessionId, measurements) {
  const { evaluate, wait, set, click } = driver;
  await evaluate(`window.__storageWrites = 0; window.__draftSerializations = 0; window.__setItem = Storage.prototype.setItem; window.__stringify = JSON.stringify;
    Storage.prototype.setItem = function(key,value) { if (key === 'flame.projectDraft.' + ${JSON.stringify(project.id)}) { window.__storageWrites++; if (window.__failStorage) throw new Error('Injected storage failure'); } return window.__setItem.call(this,key,value); };
    JSON.stringify = function(value,...rest) { if (value && typeof value === 'object' && typeof value.text === 'string' && 'submittedText' in value && 'requestId' in value) window.__draftSerializations++; return window.__stringify(value,...rest); }; true`);
  measurements.inputLatenciesMs = [];
  for (let i = 0; i < 30; i++) { measurements.inputLatenciesMs.push(await set('.composer__input', `draft ${i}`)); await delay(10); }
  assert.equal(await evaluate('window.__storageWrites'), 0, 'sustained typing does not write storage per keystroke');
  assert.equal(await evaluate('window.__draftSerializations'), 0, 'serialization is deferred too');
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  measurements.draftWrites = await evaluate('window.__storageWrites'); assert.equal(measurements.draftWrites, 1);
  await evaluate('window.__failStorage = true; true'); await set('.composer__input', 'Keep this unsaved');
  await wait("document.querySelector('.session-error')?.textContent.includes('could not be saved')");
  await click(`.session-list__item[id$="-${sessionId}"]`);
  await wait("document.querySelector('.workspace__composer').dataset.empty === 'true' && document.querySelector('.composer__input').value === 'Keep this unsaved'");
  await evaluate('window.__failStorage = false; true');
  await evaluate("[...document.querySelectorAll('.session-error button')].find(button => button.textContent === 'Retry save').click()");
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await set('.composer__input', 'Flush on switch'); await click(`.session-list__item[id$="-${sessionId}"]`); await wait("!!document.querySelector('.session-history__older')");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('flame.projectDraft.' + ${JSON.stringify(project.id)})).text`), 'Flush on switch');
  await evaluate('Storage.prototype.setItem = window.__setItem; JSON.stringify = window.__stringify; true');
}
