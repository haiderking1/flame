import assert from 'node:assert/strict';
import test from 'node:test';
import { createToastStore } from '../src/renderer/components/toasts/toastStore.ts';

test('toasts update in place, keep the newest three and notify only on change', () => {
  const store = createToastStore(); let notified = 0; store.subscribe(() => notified++);
  store.show({ id: 'a', scope: null, type: 'loading', title: 'Committing...', description: null });
  const created = store.snapshot()[0].createdAt;
  store.show({ id: 'a', scope: null, type: 'success', title: 'Committed', description: 'x' });
  assert.equal(store.snapshot().length, 1); assert.equal(store.snapshot()[0].title, 'Committed'); assert.equal(store.snapshot()[0].createdAt, created, 'updates keep their place and age');
  for (const id of ['b', 'c', 'd']) store.show({ id, scope: 'p', type: 'info', title: id, description: null });
  assert.deepEqual(store.snapshot().map(toast => toast.id), ['d', 'c', 'b'], 'newest first, capped at three');
  const before = notified; store.dismiss('missing'); assert.equal(notified, before, 'dismissing an unknown toast is silent');
  store.dismiss('c'); assert.deepEqual(store.snapshot().map(toast => toast.id), ['d', 'b']); assert.equal(store.has('c'), false);
});
