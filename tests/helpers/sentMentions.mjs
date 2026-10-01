import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Pasted file links become chips in the composer; saved messages show chips and titles show file names. */
export async function checkSentMentions({ evaluate, wait, repository, location, reload }) {
  await wait("document.querySelector('.composer__input')?.readOnly === false");
  await evaluate(`(() => { const input = document.querySelector('.composer__input'); input.focus(); getSelection().selectAllChildren(input);
    const data = new DataTransfer(); data.setData('text/plain', 'Check [app.ts](src/app.ts) now');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`);
  await wait("document.querySelector('.composer__input').value === 'Check [app.ts](src/app.ts) now' && document.querySelector('.composer__input .file-mention')?.textContent === 'app.ts'");
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  assert.equal(repository.use(location, db => db.read()).draft, 'Check [app.ts](src/app.ts) now', 'the draft stores the link');
  repository.use(location, db => db.append(db.read().revision, randomUUID(), 'Fix [app.ts](src/app.ts) and [lib](src/lib/)\nthanks'));
  await reload();
  await wait("document.querySelectorAll('.session-message--user .file-mention').length === 2");
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.session-message--user .file-mention')].map(chip => ({ name: chip.textContent, title: chip.title, icon: chip.querySelector('.file-icon').dataset.fileIcon }))`),
    [{ name: 'app.ts', title: 'src/app.ts', icon: 'typescript' }, { name: 'lib', title: 'src/lib', icon: 'folder' }]);
  assert.equal(await evaluate("document.querySelector('.session-message--user p').textContent"), 'Fix app.ts and lib\nthanks', 'the rest of the message stays plain text');
  assert.equal(repository.use(location, db => db.read()).title, 'Fix app.ts and lib', 'titles show mentioned names, not link syntax');
}
