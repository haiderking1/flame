import assert from 'node:assert/strict';
import test from 'node:test';
const logic = await import('../src/renderer/components/composer/resting/restingLogic.ts');

const gate = { enabled: true, thread: true, wide: true, overflows: true, scrolled: true, multiline: false, held: false };
test('the composer rests only for a scrolled, overflowing existing thread on a wide window', () => {
  assert.equal(logic.shouldRest(gate), true);
  for (const [field, value, why] of [['enabled', false, 'the setting is off'], ['thread', false, 'a new thread'], ['wide', false, 'a narrow window'],
    ['overflows', false, 'the thread fits'], ['scrolled', false, 'no scroll gesture'], ['multiline', true, 'a multiline draft'], ['held', true, 'a menu, drag or error']])
    assert.equal(logic.shouldRest({ ...gate, [field]: value }), false, why);
});

test('a wheel gesture rests the composer after 24px, and resets after 120ms', () => {
  const gesture = new logic.WheelGesture();
  assert.equal(gesture.add(10, 0), false);
  assert.equal(gesture.add(10, 50), false);
  assert.equal(gesture.add(4, 100), true, '24px within one gesture');
  const fresh = new logic.WheelGesture();
  assert.equal(fresh.add(20, 0), false);
  assert.equal(fresh.add(20, 200), false, 'a pause longer than 120ms starts a new gesture');
  assert.equal(fresh.add(4, 250), true);
});

test('an edit suppresses the rest of the gesture, so momentum cannot rest the composer again', () => {
  const gesture = new logic.WheelGesture();
  gesture.suppress(0);
  assert.equal(gesture.add(100, 50), false);
  assert.equal(gesture.add(100, 100), false);
  assert.equal(gesture.add(30, 300), true, 'the next gesture counts again');
});

test('wheel deltas in lines and pages become pixels', () => {
  assert.equal(logic.wheelPixels(-3, 1, 800), 48);
  assert.equal(logic.wheelPixels(1, 2, 800), 800);
  assert.equal(logic.wheelPixels(-7, 0, 800), 7);
});

test('page keys rest the composer away from the edge they scroll toward; the end is within 40px', () => {
  const view = (scrollTop) => ({ scrollTop, scrollHeight: 2000, clientHeight: 1000 });
  assert.equal(logic.scrollKeyRests('PageUp', view(500)), true);
  assert.equal(logic.scrollKeyRests('Home', view(0)), false, 'already at the top');
  assert.equal(logic.scrollKeyRests('PageDown', view(500)), true);
  assert.equal(logic.scrollKeyRests('End', view(970)), false, 'already at the end');
  assert.equal(logic.scrollKeyRests('ArrowUp', view(500)), false, 'arrow keys never rest it');
  assert.equal(logic.atEnd(view(960)), true);
  assert.equal(logic.atEnd(view(959)), false);
});
