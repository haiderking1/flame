import assert from 'node:assert/strict';

// T3 Code's resting composer: wheeling up through a long thread rests the composer as one line with its model controls
// in the strip under it; the end of the thread, focusing it, or the setting being off keeps or brings back the full composer.
export async function checkRestingComposer({ evaluate, type, wait, input, capture = async () => {} }) {
  const wheel = async deltaY => {
    const { x, y } = await evaluate("(() => { const box = document.querySelector('.session-history').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + 80 }; })()");
    await input('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  };
  const resting = "!!document.querySelector('.composer[data-resting]')";
  const reserve = () => evaluate("parseFloat(getComputedStyle(document.querySelector('.session-history')).paddingBottom)");
  await evaluate(`(() => { document.querySelector('.session-message--assistant p').style.minHeight = '2400px';
    const pane = document.querySelector('.session-history'); pane.scrollTop = pane.scrollHeight; })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(resting), false, 'the composer is full at the end of the thread');
  const fullReserve = await reserve(), fullHeight = await evaluate("document.querySelector('.composer').getBoundingClientRect().height");

  await wheel(-120);
  await wait(resting);
  const rested = await evaluate(`(() => {
    const form = document.querySelector('.composer'), input = document.querySelector('.composer__input');
    return { height: form.getBoundingClientRect().height, inputHeight: input.getBoundingClientRect().height,
      hostedModel: !!document.querySelector('.branch-toolbar__resting-host .composer-settings__model'),
      footerModel: getComputedStyle(document.querySelector('.composer__footer')).position, send: !!document.querySelector('.composer [aria-label="Send message"]') };
  })()`);
  assert.ok(Math.abs(rested.height - 50) <= 1, `a resting composer is one 32px line: ${JSON.stringify(rested)}`);
  assert.ok(rested.inputHeight <= 32.5 && rested.hostedModel && rested.footerModel === 'absolute' && rested.send, JSON.stringify(rested));
  assert.ok(fullHeight > rested.height + 40);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); await capture('composer-resting');
  assert.equal(await reserve(), fullReserve, 'the history keeps the full composer reserve, so expanding never covers what was in view');

  // Wheeling down to the end of the thread brings it back.
  for (let i = 0; i < 40 && await evaluate(resting); i++) await wheel(800);
  await wait(`!${resting}`);
  assert.ok(await evaluate("(() => { const pane = document.querySelector('.session-history'); return pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 40; })()"));

  // Clicking into the composer brings it back too.
  await wheel(-120); await wait(resting);
  await evaluate("document.querySelector('.composer__input').focus()");
  await wait(`!${resting}`);
  await evaluate('document.activeElement.blur()');

  // A draft longer than one line keeps the full composer.
  await type('.composer__input', 'first line\nsecond line', true);
  await evaluate('document.activeElement.blur()');
  await wheel(-120); await evaluate('new Promise(resolve => setTimeout(resolve, 150))');
  assert.equal(await evaluate(resting), false, 'a multiline draft keeps the full composer');
  await type('.composer__input', '', true);
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await evaluate('document.activeElement.blur()');

  // The setting turns it off.
  await evaluate(`(() => { const key = 'flame.settings.client', saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...saved, composerCollapseOnScroll: false })); dispatchEvent(new StorageEvent('storage', { key })); })()`);
  await wheel(-120); await evaluate('new Promise(resolve => setTimeout(resolve, 150))');
  assert.equal(await evaluate(resting), false, 'with "Collapse composer on scroll" off the composer stays full');
  await evaluate(`(() => { const key = 'flame.settings.client', saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...saved, composerCollapseOnScroll: true })); dispatchEvent(new StorageEvent('storage', { key })); })()`);
  await evaluate(`(() => { document.querySelector('.session-message--assistant p').style.removeProperty('min-height');
    const pane = document.querySelector('.session-history'); pane.scrollTop = pane.scrollHeight; })()`);
  await wait(`!${resting}`);
}
