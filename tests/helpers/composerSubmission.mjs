import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkComposerSubmission(appPath, evaluate) {
  // Test-only callback. No agent or send stub is added to the application.
  const workspacePath = join(dirname(appPath), 'components/sessions/SessionWorkspace.tsx');
  await writeFile(workspacePath, (await readFile(workspacePath, "utf8")).replace("onSend={active ? sessions.send : undefined}", `onSend={async (message) => {
    window.__sendCount = (window.__sendCount ?? 0) + 1;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (window.__rejectSend) throw new Error("test rejection");
    window.__sentMessage = message;
    sessions.editDraft('');
  }}`).replace('export function SessionWorkspace()', 'window.__sessionSubmitFixtureReady = true;\nexport function SessionWorkspace()'));

  async function waitFor(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(30);
    }
    assert.fail(`Timed out: ${expression}`);
  }

  await waitFor("window.__sessionSubmitFixtureReady === true && document.querySelector('button[type=submit]').disabled === false");
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate(`window.__rejectSend = true;
    document.querySelector('form').requestSubmit();
    document.querySelector('form').requestSubmit();`);
  await waitFor("document.querySelector('.composer [role=status]').textContent.includes('Could not send')");
  assert.equal(await evaluate("window.__sendCount"), 1, "Duplicate submit was not blocked");
  assert.equal(await evaluate("document.querySelector('textarea').value"), "draft preserved");

  await evaluate("window.__rejectSend = false; document.querySelector('form').requestSubmit()");
  await waitFor("document.querySelector('textarea').value === ''");
  assert.equal(await evaluate("window.__sentMessage"), "draft preserved");
  assert.equal(await evaluate("window.__sendCount"), 2);
  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled"), true);
  await waitFor("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
}
