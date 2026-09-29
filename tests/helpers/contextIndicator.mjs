import assert from 'node:assert/strict';

export async function checkContextIndicator({ evaluate, known = false }) {
  const geometry = await evaluate(`(() => {
    const actions = document.querySelector('.composer-actions');
    const context = actions.querySelector('.context-indicator');
    const attach = actions.querySelector('.composer-actions__attach');
    const send = actions.querySelector('.composer-actions__send');
    const meter = context.querySelector('[role=meter]');
    const box = context.getBoundingClientRect(), sendBox = send.getBoundingClientRect();
    return {
      width: box.width, height: box.height, sendWidth: sendBox.width, sendHeight: sendBox.height,
      centered: Math.abs((box.top + box.bottom) - (sendBox.top + sendBox.bottom)) < 1,
      order: attach.nextElementSibling === context && context.nextElementSibling === send,
      radius: getComputedStyle(context).borderRadius,
      interactive: context.matches('button, [role=button]') || context.tabIndex >= 0,
      label: context.querySelector('.context-indicator__label').textContent,
      percentage: Number(meter.getAttribute('aria-valuenow')),
      detail: meter.getAttribute('aria-valuetext'),
      bottomRow: !!document.querySelector('.context-status'),
      fits: actions.getBoundingClientRect().right <= document.querySelector('.composer').getBoundingClientRect().right
    };
  })()`);
  assert.ok(Math.abs(geometry.width - 32) < 1);
  assert.ok(Math.abs(geometry.height - 32) < 1);
  assert.ok(Math.abs(geometry.width - geometry.sendWidth) < 1);
  assert.ok(Math.abs(geometry.height - geometry.sendHeight) < 1);
  assert.equal(geometry.radius, '50%');
  assert.ok(geometry.order && geometry.centered && geometry.fits, 'attach, context, send are adjacent and aligned');
  assert.equal(geometry.bottomRow, false, 'context no longer adds a composer row');
  assert.equal(geometry.interactive, false, 'context circle is display-only');
  assert.ok(geometry.percentage >= 0 && geometry.percentage <= 100);
  assert.ok(geometry.detail.includes('90%'), 'automatic threshold stays available to assistive technology');
  assert.equal(known ? geometry.label.endsWith('%') : geometry.label === '?', true);
}
