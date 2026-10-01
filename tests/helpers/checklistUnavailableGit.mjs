import assert from 'node:assert/strict';
export async function checkUnavailableGit(driver, repository, location) {
  const { click, wait, set, evaluate } = driver;
  await wait("document.querySelector('.git-control__primary')?.getAttribute('aria-disabled') === 'true'");
  await click('[aria-label="Git action options"]'); await wait("document.querySelector('.git-actions-menu')?.textContent.includes('newer Flame version')");
  await evaluate("document.querySelector('.git-actions-menu').hidePopover(); true");
  await click(`.session-list__item[id$="-${location.sessionId}"]`);
  await wait("!document.querySelector('.composer__input').readOnly && document.querySelector('.workspace__composer').dataset.empty !== 'true'");
  await set('.composer__input','Chat remains available');
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  assert.equal(repository.use(location, db => db.read().draft), 'Chat remains available', 'session writes still reach the backend');
  assert.equal(await evaluate("document.querySelector('.git-dialog') === null"), true);
}
