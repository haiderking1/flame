import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkDevelopmentDiff({ evaluate, folder }) {
  await promisify(execFile)('git',['-c','init.templateDir=','init','--initial-branch=main',folder]);
  await writeFile(join(folder,'first-preview.ts'),'export const previewNoReload = true;\n');
  await evaluate("window.__firstDiffMarker='same-renderer'; document.querySelector('[aria-controls=workspace-diff]').click(); true");
  async function wait(expression) {
    for(let attempt=0;attempt<500;attempt++) {
      if(await evaluate(expression)) return;
      await delay(20);
    }
    assert.fail(`First development diff never became ready: ${expression}`);
  }
  await wait("!!document.querySelector('[data-review-file=\"first-preview.ts\"]')");
  await evaluate("document.querySelector('[data-review-file=\"first-preview.ts\"]').click(); true");
  await wait("[...document.querySelectorAll('diffs-container')].some(node=>node.shadowRoot?.textContent.includes('previewNoReload'))");
  // New optimizer discoveries can schedule a reload after the file first renders.
  await delay(1000);
  assert.equal(await evaluate('window.__firstDiffMarker'),'same-renderer','first preview must not reload the renderer');
  assert.equal(await evaluate("document.querySelector('textarea').value"),'draft preserved','first preview keeps the live composer draft');
  await evaluate("document.querySelector('[aria-label=\"Close diff panel\"]').click(); true");
}
