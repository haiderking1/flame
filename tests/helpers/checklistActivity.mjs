import assert from 'node:assert/strict';
import { captureUI } from './captureUI.mjs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export function seedActivity(repository, projectId) {
  const location = { projectId, sessionId: randomUUID() }, settings = { modelId: 'test-model', effort: 'low', serviceTier: 'default' };
  repository.create(location, settings);
  repository.use(location, db => {
    const turn = randomUUID(); db.turns.start(db.read().revision, turn, 'Nested activity', settings);
    const output = [];
    for (let i = 0; i < 180; i++) {
      if (i < 60) output.push({ type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: `Inspecting file ${i}.` }] });
      output.push({ type: 'function_call', name: 'read', call_id: `call_${i}`, arguments: JSON.stringify({ path: `tool-${i}.txt` }) });
      output.push({ type: 'function_call_output', call_id: `call_${i}`, output: JSON.stringify({ status: 'completed', summary: `Read file ${i}.`, content: `Complete source for file ${i}.\n`.repeat(500) }) });
    }
    output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Activity complete.' }] });
    db.turns.finish(turn, 'completed', 'Activity complete.', null, output);
    db.rename(db.read().revision, 'Nested work benchmark');
  });
  return location;
}
export async function checkActivity(driver, location) {
  const { click, wait, evaluate, settle } = driver;
  await click(`.session-list__item[id$="-${location.sessionId}"]`); await wait("!!document.querySelector('.work-group [data-virtual-list=true]')");
  await evaluate("document.querySelector('.session-history').scrollTop = document.querySelector('.session-history').scrollHeight; true"); await delay(150); await settle();
  await wait("[...document.querySelectorAll('.work-tool__command')].some(node => node.textContent === 'Read tool-179.txt')");
  assert.equal(await evaluate("[...document.querySelectorAll('.work-tool__command')].find(node => node.textContent === 'Read tool-179.txt').parentElement.querySelector('.file-icon')?.dataset.fileIcon"), 'text', 'file tool rows show the file-type icon');
  await captureUI(driver, 'tool-row-icons');
  await evaluate("[...document.querySelectorAll('.work-tool__toggle')].find(node => node.textContent.includes('Read tool-179.txt')).click()");
  await wait("[...document.querySelectorAll('.work-tool__output')].some(node => node.textContent.includes('Complete source for file 179'))");
  assert.ok(await evaluate("document.querySelector('.session-history').querySelectorAll('*').length < 3000"), 'nested activity and tool lists are independently bounded');
  await evaluate("document.querySelector('textarea').focus(); document.querySelector('.session-history').scrollTop = 0; true"); await delay(100); await settle();
  await wait("![...document.querySelectorAll('.work-tool__command')].some(node => node.textContent === 'Read tool-179.txt')");
  await evaluate("document.querySelector('.session-history').scrollTop = document.querySelector('.session-history').scrollHeight; true"); await delay(150); await settle();
  await wait("[...document.querySelectorAll('.work-tool__toggle')].some(node => node.textContent.includes('Read tool-179.txt') && node.getAttribute('aria-expanded') === 'true')");
}
