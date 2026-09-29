import assert from 'node:assert/strict';

export async function checkSlashCommandStyle(evaluate) {
  const layout = await evaluate(`(() => {
    const panel = document.querySelector('.slash-commands');
    const layer = document.querySelector('.slash-commands-layer');
    const composer = document.querySelector('.composer');
    const option = panel.querySelector('[role=option]');
    const name = option.querySelector('.slash-commands__name');
    const description = option.querySelector('.slash-commands__description');
    const box = layer.getBoundingClientRect(), composerBox = composer.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect(), descriptionBox = description.getBoundingClientRect();
    const optionBox = option.getBoundingClientRect();
    return {
      insetLeft: box.left - composerBox.left, insetRight: composerBox.right - box.right,
      overlap: box.bottom - composerBox.top,
      sameLine: Math.abs((nameBox.top + nameBox.bottom) - (descriptionBox.top + descriptionBox.bottom)) < 1,
      ellipsis: getComputedStyle(description).textOverflow,
      horizontal: getComputedStyle(option).flexDirection,
      selected: option.getAttribute('aria-selected'),
      pointerReachable: option.contains(document.elementFromPoint(optionBox.left + optionBox.width / 2, optionBox.top + optionBox.height / 2)),
      active: document.querySelector('textarea').getAttribute('aria-activedescendant') === option.id,
      background: getComputedStyle(option).backgroundColor,
      bottomRadius: getComputedStyle(panel, '::before').borderBottomLeftRadius,
      topRadius: getComputedStyle(panel, '::before').borderTopLeftRadius,
      fontSize: getComputedStyle(name).fontSize,
      mask: getComputedStyle(panel, '::before').maskImage,
      top: box.top,
      position: getComputedStyle(layer).position
    };
  })()`);
  assert.ok(layout.insetLeft >= 12 && layout.insetRight >= 12, 'list is narrower than composer');
  assert.ok(Math.abs(layout.insetLeft - layout.insetRight) < 1, 'list is centered');
  assert.ok(layout.overlap > 0 && layout.overlap < 24, 'panel tucks behind composer without a gap');
  assert.equal(layout.bottomRadius, '0px');
  assert.equal(layout.topRadius, '16px');
  assert.equal(layout.fontSize, '12px');
  assert.equal(layout.position, 'fixed');
  assert.ok(layout.top >= 24 - 1, 'drawer stays inside the viewport');
  assert.ok(layout.mask.includes('linear-gradient'), 'glass is masked at the composer seam');
  assert.ok(layout.sameLine && layout.horizontal === 'row', 'command and muted description share one line');
  assert.equal(layout.ellipsis, 'ellipsis');
  assert.equal(layout.selected, 'true');
  assert.notEqual(layout.background, 'rgba(0, 0, 0, 0)', 'selected row has a subtle highlight');
  assert.ok(layout.pointerReachable, 'the behind-composer panel still receives pointer clicks');
  assert.ok(layout.active, 'textarea announces the selected command');
}
