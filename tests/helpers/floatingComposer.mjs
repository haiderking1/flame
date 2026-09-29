import assert from 'node:assert/strict';

export async function checkFloatingComposer({ evaluate, type, wait, resize }) {
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  const dimensions = () => evaluate(`(() => {
    const wrapper = document.querySelector('.workspace__composer');
    const form = document.querySelector('.composer');
    const timeline = document.querySelector('.session-history');
    const card = form.getBoundingClientRect();
    const glass = getComputedStyle(form, '::before');
    const host = document.querySelector('.workspace__chat');
    const available = host.clientWidth - parseFloat(getComputedStyle(host).paddingLeft) - parseFloat(getComputedStyle(host).paddingRight);
    return { width: card.width, available, maxWidth: getComputedStyle(wrapper).maxWidth, height: card.height, radius: getComputedStyle(form).borderRadius,
      padding: getComputedStyle(form).paddingTop, position: getComputedStyle(wrapper).position,
      background: getComputedStyle(wrapper).backgroundColor, glass: glass.backgroundColor, blur: glass.backdropFilter,
      reserve: parseFloat(getComputedStyle(timeline).paddingBottom), overlay: wrapper.getBoundingClientRect().height,
      overlaps: timeline.getBoundingClientRect().bottom > card.top,
      scrollbarRight: timeline.getBoundingClientRect().right, paneRight: host.getBoundingClientRect().right,
      content: timeline.querySelector('.session-history__content').getBoundingClientRect().toJSON(),
      cardLeft: card.left, cardRight: card.right,
      lastBottom: timeline.querySelector('.session-message:last-of-type').getBoundingClientRect().bottom,
      composerTop: wrapper.getBoundingClientRect().top };
  })()`);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.session-history'), '::-webkit-scrollbar-thumb').backgroundColor"), 'rgba(255, 255, 255, 0.08)');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('textarea'), '::-webkit-scrollbar-thumb').backgroundColor"), 'rgb(80, 80, 80)', 'chat colors must not change the composer scrollbar');
  const initial = await dimensions();
  assert.equal(initial.maxWidth, '768px');
  assert.equal(Math.round(initial.width), Math.min(initial.available, 768));
  assert.ok(Math.abs(initial.height - 144) <= 1, `resting expanded height matches within zoom rounding: ${initial.height}`);
  assert.equal(initial.radius, '24px'); assert.equal(initial.padding, '16px');
  assert.equal(initial.position, 'absolute'); assert.equal(initial.background, 'rgba(0, 0, 0, 0)');
  assert.equal(initial.glass, 'rgba(17, 17, 17, 0.8)'); assert.ok(initial.blur.includes('blur(12px)'));
  const aligned = (metrics) => {
    assert.ok(Math.abs(metrics.scrollbarRight - metrics.paneRight) <= 1, 'scrollbar belongs at the far-right edge of the chat pane');
    assert.ok(Math.abs(metrics.content.left - metrics.cardLeft) <= 1 && Math.abs(metrics.content.right - metrics.cardRight) <= 1,
      `messages stay aligned with the composer: ${JSON.stringify(metrics)}`);
  };
  aligned(initial);
  assert.ok(initial.overlaps, 'history must extend beneath the floating surface');
  assert.ok(initial.reserve >= initial.overlay + 15, 'reserve the full composer height');
  assert.equal(await evaluate("document.body.textContent.includes('Saved locally') || document.body.textContent.includes('Tools are not connected')"), false);

  // Exercise a tall timeline without sending extra messages or modifying saved content.
  await evaluate(`(() => { const message = document.querySelector('.session-message--assistant p');
    message.style.minHeight = '1200px'; const pane = document.querySelector('.session-history'); pane.scrollTop = pane.scrollHeight; })()`);
  await type('textarea', Array.from({ length: 20 }, (_, i) => 'draft line ' + i).join('\n'), true);
  await wait(`document.querySelector('textarea').value.includes('draft line 19') && document.querySelector('.composer').getBoundingClientRect().height > ${initial.height + 20}`);
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await wait("parseFloat(getComputedStyle(document.querySelector('.session-history')).paddingBottom) >= document.querySelector('.workspace__composer').getBoundingClientRect().height + 15");
  const expanded = await dimensions();
  assert.ok(expanded.height > initial.height + 20, `long drafts expand the floating card within the viewport cap: ${JSON.stringify({ initial, expanded })}`);
  assert.ok(expanded.lastBottom <= expanded.composerTop - 12, 'last message remains above the expanded composer when following');
  await evaluate("document.querySelector('.session-history').scrollTop = 0");
  await type('textarea', 'Short draft', true);
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  assert.equal(await evaluate("document.querySelector('.session-history').scrollTop"), 0, 'resizing must not pull a reader away from older messages');
  await type('textarea', '', true);
  await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
  await evaluate("document.querySelector('.session-message--assistant p').style.removeProperty('min-height')");
  for (const width of [900, 630, 2200]) {
    await resize(width);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    aligned(await dimensions());
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow at narrow widths');
  }
}
