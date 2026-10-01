import assert from 'node:assert/strict';

export async function checkSessionSidebar({ evaluate, wait, click, pointerClick, type, repository, active, inactive }) {
  const options = title => `[aria-label="Options for ${title}"]`;
  async function menu(title) {
    await wait(`!!document.querySelector(${JSON.stringify(options(title))}) && !document.querySelector(${JSON.stringify(options(title))}).disabled`);
    await click(options(title));
    await wait("!!document.querySelector('.session-menu')");
    const box = await evaluate(`(() => { const menu = document.querySelector('.session-menu'); const rect = menu.getBoundingClientRect(); return { ...rect.toJSON(), visible: menu.contains(document.elementFromPoint(rect.left + 12, rect.top + 12)), viewportWidth: innerWidth, viewportHeight: innerHeight }; })()`);
    assert.ok(box.visible && box.left >= 0 && box.right <= box.viewportWidth && box.top >= 0 && box.bottom <= box.viewportHeight, JSON.stringify(box));
  }
  async function choose(label) {
    await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent === ${JSON.stringify(label)}).click()`);
  }
  assert.ok(await evaluate(`(() => {
    const row = document.querySelector('.session-list__item');
    const icon = row.querySelector('.session-list__provider');
    const project = row.querySelector('.session-list__project').getBoundingClientRect();
    const title = row.querySelector('.session-list__title').getBoundingClientRect();
    const footer = row.querySelector('.session-list__detail').getBoundingClientRect();
    return Math.abs(row.getBoundingClientRect().height - 78) < 1 && project.top < title.top && title.top < footer.top
      && icon.complete && icon.naturalWidth > 0 && Math.abs(parseFloat(getComputedStyle(icon).width) - 14) < .1 && getComputedStyle(icon).opacity === '0.6'
      && Math.abs(new DOMMatrix(getComputedStyle(icon).transform).a - 611 / 411) < .00001
      && !!row.querySelector('.session-list__project time');
  })()`), 'cards have project/time, title, and a loaded 14px provider SVG footer');
  await type('.composer__input', 'Keep this draft', true);
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await wait("!document.querySelector('[aria-label=\"Options for Hello from B\"]').disabled");
  await pointerClick(options('Hello from B'));
  await wait("!!document.querySelector('.session-menu')");
  await pointerClick(options('Hello from B'));
  await wait("!document.querySelector('.session-menu')");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Options for Hello from B\"]').getAttribute('aria-expanded')"), 'false', 'second pointer click closes rather than reopening');
  assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), 'none', 'pointer focus leaves no outline');
  await pointerClick(options('Hello from B'));
  await wait("!!document.querySelector('.session-menu')");
  await pointerClick('.composer__input');
  await wait("!document.querySelector('.session-menu')");
  assert.equal(await evaluate("document.activeElement.classList.contains('composer__input')"), true, 'outside pointer dismissal preserves the clicked focus target');
  await menu('Hello from B');
  assert.equal(await evaluate('document.activeElement.textContent'), 'Rename');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))");
  assert.equal(await evaluate('document.activeElement.textContent'), 'Settle');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))");
  assert.equal(await evaluate('document.activeElement.textContent'), 'Mark unread', 'a finished, seen thread can be marked unread');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}))");
  assert.equal(await evaluate('document.activeElement.textContent'), 'Delete');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
  await wait("!document.querySelector('.session-menu')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Options for Hello from B');
  await menu('Hello from B'); await choose('Rename');
  await wait("!!document.querySelector('[aria-label=\"Thread title\"]')");
  await type('[aria-label="Thread title"]', 'Renamed thread', true);
  await evaluate("document.querySelector('[aria-label=\"Thread title\"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}))");
  await wait("!!document.querySelector('[aria-label=\"Options for Renamed thread\"]') && !document.querySelector('.session-list__rename')");
  assert.equal(repository.use(inactive, db => db.read()).title, 'Renamed thread');
  assert.equal(await evaluate("document.querySelector('.composer__input').value"), 'Keep this draft', 'renaming another thread does not navigate or replace drafts');
  await menu('New session'); await choose('Rename');
  await type('[aria-label="Thread title"]', 'Discard this title', true);
  await evaluate("document.querySelector('.session-list__rename').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
  await wait("!document.querySelector('.session-list__rename')");
  assert.equal(repository.use(active, db => db.read()).title, 'New session');
  await menu('New session'); await choose('Rename');
  await type('[aria-label="Thread title"]', 'Active renamed', true);
  await evaluate("document.querySelector('.session-list__rename').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}))");
  await wait("document.querySelector('.session-list__item[aria-current]')?.getAttribute('aria-label') === 'Active renamed' && !document.querySelector('.session-list__rename')");
  assert.equal(repository.use(active, db => db.read()).draft, 'Keep this draft');
  await menu('Renamed thread'); await choose('Delete');
  await wait("!!document.querySelector('.session-dialog[open]')");
  assert.equal(await evaluate('document.activeElement.textContent'), 'Cancel');
  await evaluate("document.activeElement.click()");
  assert.ok(repository.list().sessions.some(s => s.sessionId === inactive.sessionId));
  await menu('Renamed thread'); await choose('Delete');
  await click('.session-dialog button[type=submit]');
  await wait("!document.querySelector('.session-dialog') && !document.querySelector('[aria-label=\"Options for Renamed thread\"]')");
  assert.equal(repository.list().sessions.some(s => s.sessionId === inactive.sessionId), false);
  assert.equal(await evaluate("document.querySelector('.composer__input').value"), 'Keep this draft');
  await menu('Active renamed'); await choose('Delete');
  repository.use(active, db => db.draft(db.read().revision, 'Changed elsewhere'));
  await click('.session-dialog button[type=submit]');
  await wait("document.querySelector('.session-dialog [role=alert]')?.textContent.includes('changed elsewhere')");
  assert.ok(repository.list().sessions.some(s => s.sessionId === active.sessionId), 'failed deletion keeps the session');
  assert.equal(await evaluate("document.querySelector('.composer__input').value"), 'Keep this draft', 'failed deletion preserves the displayed draft');
  await click('.session-dialog button[type=button]');
  await click('.session-list__item[aria-current]');
  await wait("document.querySelector('.composer__input').value === 'Changed elsewhere' && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await menu('Active renamed'); await choose('Delete');
  await click('.session-dialog button[type=submit]');
  await wait("!document.querySelector('.session-dialog') && !document.querySelector('.session-list__item[aria-current]')");
  assert.equal(repository.list().sessions.some(s => s.sessionId === active.sessionId), false);
}
