import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageUploadQueue } from '../src/renderer/components/images/upload-queue.ts';
const location = { projectId: 'project', sessionId: 'draft' };
const image = (id, contents = id) => ({ id, name: `${id}.png`, file: new Blob([contents], { type: 'image/png' }) });
const info = image => ({ id: image.id, name: image.name, bytes: image.file.size });
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const calls = [], pending = new Map();
  const queue = new ImageUploadQueue((location, image, signal, progress) => {
    calls.push({ location, image, signal, progress });
    return new Promise((resolve, reject) => {
      pending.set(image.id, { resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  queue.retain(location);
  return { queue, calls, pending, done(id) { const own = calls.findLast(call => call.image.id === id); pending.get(id).resolve(info(own.image)); } };
}

test('background upload queue caps active transfers at three and reuses one flight per ID', async () => {
  const h = harness(), images = ['a', 'b', 'c', 'd'].map(id => image(id));
  await h.queue.enqueue(location, images);
  await h.queue.enqueue(location, images);
  assert.equal(h.calls.length, 3); assert.equal(h.queue.state(location, 'd').status, 'queued');
  h.calls[0].progress('uploading', 50);
  assert.equal(h.queue.state(location, 'a').progress, 50);
  h.calls[0].progress('preparing', 100);
  assert.equal(h.queue.state(location, 'a').status, 'preparing', '100% transfer is not ready before confirmation');
  h.done('a'); await tick();
  assert.equal(h.calls.length, 4); assert.equal(h.queue.state(location, 'a').status, 'ready');
  for (const id of ['b', 'c', 'd']) h.done(id);
  assert.equal((await h.queue.ready(location, images)).length, 4);
  assert.equal(h.calls.length, 4, 'Send with ready attachments does not upload again');
});

test('restore verifies readiness in one batch and uploads only missing images', async () => {
  const h = harness(), images = ['saved', 'missing'].map(id => image(id));
  await h.queue.restore(location, images, async ids => { assert.deepEqual(ids, ['saved', 'missing']); return [info(images[0])]; });
  assert.equal(h.queue.state(location, 'saved').status, 'ready');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].image.id, 'missing');
  h.done('missing'); await h.queue.ready(location, images);
  await h.queue.restore(location, images, async () => assert.fail('navigation must retain readiness in memory'));
});

test('cancel Send wait preserves pending and ready uploads for another attempt', async () => {
  const h = harness(), attachment = image('a'), abort = new AbortController();
  const waiting = h.queue.ready(location, [attachment], abort.signal);
  await tick(); abort.abort(); await assert.rejects(waiting);
  assert.equal(h.calls[0].signal.aborted, false, 'send cancellation does not discard background uploads');
  h.done('a'); await tick();
  await h.queue.ready(location, [attachment]); assert.equal(h.calls.length, 1);
});

test('remove aborts active work and fences queued, checking, and late completions', async () => {
  const h = harness(), images = ['a', 'b', 'c', 'd'].map(id => image(id));
  await h.queue.enqueue(location, images);
  let discards = 0;
  await h.queue.remove(location, 'd', async () => { discards++; });
  await h.queue.remove(location, 'a', async () => { discards++; });
  await tick();
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.calls.length, 3);
  await h.queue.enqueue(location, images);
  assert.equal(h.queue.state(location, 'a'), undefined); assert.equal(h.queue.state(location, 'd'), undefined);
  assert.equal(discards, 2);
  let resolve;
  const restoring = h.queue.restore(location, [image('checking')], () => new Promise(yes => { resolve = yes; }));
  await tick(); await h.queue.remove(location, 'checking', async () => {});
  resolve([info(image('checking'))]); await restoring;
  assert.equal(h.queue.state(location, 'checking'), undefined);
  h.done('b'); h.done('c'); await tick();
});

test('failure and invalidated adoption retry keep immutable IDs and reject descriptor collisions', async () => {
  const h = harness(), attachment = image('a');
  const waiting = h.queue.ready(location, [attachment]); await tick();
  h.pending.get('a').reject(new Error('network failed')); await assert.rejects(waiting, /network failed/);
  assert.equal(h.queue.state(location, 'a').status, 'failed');
  h.queue.retry(location, attachment); await tick(); h.done('a'); await tick();
  h.queue.invalidate(location, ['a'], 'stage expired');
  assert.equal(h.queue.state(location, 'a').status, 'failed');
  const again = h.queue.ready(location, [attachment]); await tick(); h.done('a'); await again;
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(call => call.image.id === 'a'));
  await h.queue.enqueue(location, [image('a')]);
  await assert.rejects(h.queue.enqueue(location, [{ ...attachment, name: 'changed.png' }]), /different original/);
  await assert.rejects(h.queue.enqueue(location, [image('a', 'z')]), /different original/, 'same-size changed Blob must not reuse cached ready ID');
});

test('project scope isolates identical IDs and rejected restore does not silently upload', async () => {
  const h = harness(), attachment = image('same');
  await h.queue.restore(location, [attachment], async () => { throw new Error('offline'); });
  assert.equal(h.queue.state(location, 'same').status, 'failed'); assert.equal(h.calls.length, 0);
  const other = { ...location, sessionId: 'another' };
  await h.queue.enqueue(other, [attachment]);
  assert.equal(h.calls.length, 1); assert.equal(h.queue.state(location, 'same').status, 'failed');
  h.done('same'); await tick();
});


test('scope release preserves active jobs and drops settled original blobs; deleted scopes cannot resurrect', async () => {
  const pending = new Map();
  const queue = new ImageUploadQueue((_location, image) => new Promise(resolve => pending.set(image.id, resolve)));
  const release = queue.retain(location);
  await queue.enqueue(location, [image('active')]); await tick();
  release(); assert.equal(queue.state(location, 'active').status, 'hashing');
  pending.get('active')(info(image('active'))); await tick();
  assert.equal(queue.state(location, 'active'), undefined, 'unmounted scope releases settled original Blob');
  const owned = queue.retain(location); await queue.enqueue(location, [image('removed')]); await tick();
  queue.clearScope(location); pending.get('removed')(info(image('removed'))); await tick();
  assert.equal(queue.state(location, 'removed'), undefined);
  await assert.rejects(queue.enqueue(location, [image('later')]), { name: 'AbortError' }); owned();
});

test('accepted IDs cannot be enqueued by late draft writes after cleanup', async () => {
  const h = harness(), attachment = image('accepted');
  await h.queue.enqueue(location, [attachment]); await tick(); h.done('accepted'); await tick();
  h.queue.forget(location, ['accepted']);
  await h.queue.enqueue(location, [attachment]);
  assert.equal(h.queue.state(location, 'accepted'), undefined);
  assert.equal(h.calls.length, 1, 'accepted attachment is not posted again by stale writer');
});
