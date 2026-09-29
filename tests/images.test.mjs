import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileHarness, settings, account } from './helpers/fileTools.mjs';
import { png, upload } from './helpers/images.mjs';
import { Images } from '../dist/backend/images/service.js';
import { normalizeImage } from '../dist/backend/images/normalize.js';
import { probeImage } from '../dist/backend/images/probe.js';
import { hashImage } from '../dist/backend/images/files.js';
import { IMAGE_CHUNK_BYTES, MAX_IMAGE_BYTES } from '../dist/contracts/image-types.js';
import { fitsInputBudget } from '../dist/backend/turns/input-budget.js';

const opts = { skip: process.platform === 'win32' };
test('Photon normalizes actual PNG pixels in a worker and bounds dimensions without enlarging small images', opts, async () => {
  const image = await normalizeImage(png(2100, 100), new AbortController().signal);
  assert.equal(image.width, 2100); assert.equal(image.height, 100);
  assert.equal(image.modelWidth, 2000); assert.ok(image.modelHeight <= 100);
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(probeImage(image.data), { mimeType: 'image/png', width: image.modelWidth, height: image.modelHeight, orientation: 1 });
  assert.ok(Buffer.from(image.data).toString('base64').length < 4.5 * 1024 * 1024);
  const small = await normalizeImage(png(2, 3), new AbortController().signal);
  assert.equal(small.modelWidth, 2); assert.equal(small.modelHeight, 3);
});

test('reject unsupported, truncated, oversized images and pre-aborted normalization without decoding', opts, async () => {
  const signal = new AbortController().signal;
  assert.throws(() => normalizeImage(Buffer.from('<svg/>'), signal), /valid PNG/);
  assert.throws(() => normalizeImage(Buffer.from('GIF89a'), signal), /damaged/);
  assert.throws(() => normalizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), signal), /20 MiB/);
  const dimensions = png(); dimensions.writeUInt32BE(100000, 16);
  assert.throws(() => normalizeImage(dimensions, signal), /megapixel/);
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => normalizeImage(png(), cancelled.signal));
  const active = new AbortController(), work = normalizeImage(png(2100, 100), active.signal); active.abort();
  await assert.rejects(work, /stopped/);
});

test('durable uploads require exact ordered chunks and fingerprints, and resume idempotently', opts, t => {
  const h = fileHarness(t, false), id = randomUUID(), data = png(), hash = hashImage(data);
  h.sessions.images(h.location, store => store.begin(id, 'reference.png', data.length, hash));
  assert.throws(() => h.sessions.images(h.location, store => store.begin(id, 'other.png', data.length, hash)), /another attachment/);
  assert.throws(() => h.sessions.images(h.location, store => store.source(id)), /incomplete/);
  assert.throws(() => h.sessions.images(h.location, store => store.chunk(id, 1, data.toString('base64'))), /in order/);
  const first = data.subarray(0, 10).toString('base64');
  h.sessions.images(h.location, store => store.chunk(id, 0, first));
  h.sessions.images(h.location, store => store.chunk(id, 0, first));
  assert.throws(() => h.sessions.images(h.location, store => store.chunk(id, 0, Buffer.alloc(10).toString('base64'))), /changed/);
  assert.throws(() => h.sessions.images(h.location, store => store.chunk(id, 10, '!!!!')), /Invalid/);
  assert.throws(() => h.sessions.images(h.location, store => store.chunk(id, 10, Buffer.alloc(IMAGE_CHUNK_BYTES + 1).toString('base64'))), /Invalid/);
  h.sessions.images(h.location, store => store.chunk(id, 10, data.subarray(10).toString('base64')));
  assert.deepEqual(h.sessions.images(h.location, store => store.source(id)).data, data);
  const bad = randomUUID();
  h.sessions.images(h.location, store => { store.begin(bad, 'bad.png', data.length, '0'.repeat(64)); store.chunk(bad, 0, data.toString('base64')); });
  assert.throws(() => h.sessions.images(h.location, store => store.source(bad)), /checksum/);
});

test('images persist privately with original bytes, bounded previews and model content after restart', opts, async t => {
  const h = fileHarness(t, false), images = new Images(h.sessions); t.after(() => images.close());
  const saved = await upload(h, images);
  assert.equal(saved.info.sha256, hashImage(saved.data)); assert.equal(saved.info.mimeType, 'image/png');
  const target = join(h.root, 'projects', h.location.projectId, 'sessions', h.location.sessionId, 'images', `${saved.id}.original`);
  assert.deepEqual(readFileSync(target), saved.data);
  h.sessions.turns(h.location, store => store.start(0, h.turnId, '', settings, account.key, [saved.id]));
  const history = h.sessions.history(h.location, null);
  assert.equal(history.entries[0].text, ''); assert.equal(history.entries[0].requestId, h.turnId);
  assert.deepEqual(history.entries[0].images, [saved.info]);
  assert.ok(!JSON.stringify(history).includes('base64,'));
  const content = h.sessions.turns(h.location, store => store.context(settings, account.key))[0].content;
  assert.equal(content[1].type, 'input_text'); assert.equal(content[2].type, 'input_image'); assert.equal(content[2].detail, 'auto');
  const original = h.sessions.images(h.location, store => store.read(saved.id, 0));
  assert.deepEqual(Buffer.from(original.data, 'base64'), saved.data); assert.equal(original.next, null);
  const preview = h.sessions.images(h.location, store => store.read(saved.id, 0, true));
  assert.equal(hashImage(Buffer.from(preview.data, 'base64')), saved.info.modelSha256);
  assert.deepEqual(await images.finish(h.location, saved.id, new AbortController().signal), saved.info);
  h.sessions.images(h.location, store => store.discard(saved.id));
  assert.ok(h.sessions.images(h.location, store => store.info(saved.id)), 'discard cannot delete sent attachments');
  h.sessions.turns(h.location, store => store.finish(h.turnId, 'completed', 'Seen', null));
  assert.throws(() => h.sessions.append(h.location, h.sessions.read(h.location).revision, randomUUID(), 'Replay', [saved.id]), /already sent/);
  assert.equal(h.sessions.history(h.location, null).entries.filter(entry => entry.kind === 'user').length, 1, 'failed binding rolls back append');
  assert.throws(() => h.sessions.turns(h.location, store => store.start(0, h.turnId, '', settings, account.key, [])), /another message/);
});

test('private image reads reject changed bytes and symlink replacement; unsent uploads can be removed', opts, async t => {
  const h = fileHarness(t, false), images = new Images(h.sessions); t.after(() => images.close());
  const saved = await upload(h, images);
  const target = join(h.root, 'projects', h.location.projectId, 'sessions', h.location.sessionId, 'images', `${saved.id}.model`);
  writeFileSync(target, Buffer.alloc(saved.info.modelBytes)); chmodSync(target, 0o600);
  assert.throws(() => h.sessions.images(h.location, store => store.content([saved.id])), /changed/);
  const original = target.replace(/\.model$/, '.original'); unlinkSync(target); symlinkSync(original, target);
  assert.throws(() => h.sessions.images(h.location, store => store.read(saved.id, 0, true)));
  images.discard(h.location, saved.id);
  assert.equal(h.sessions.images(h.location, store => store.info(saved.id)), null);
});

test('unprepared, duplicate and more than ten image IDs cannot be bound; upload slots are bounded', opts, t => {
  const h = fileHarness(t, false), missing = randomUUID();
  assert.throws(() => h.sessions.append(h.location, 0, randomUUID(), '', [missing]), /not finished/);
  assert.throws(() => h.sessions.images(h.location, store => store.assertIds(Array(11).fill(missing))), /10 distinct/);
  assert.throws(() => h.sessions.images(h.location, store => store.begin(missing, 'x', MAX_IMAGE_BYTES + 1, 'a'.repeat(64))), /20 MiB/);
  for (let i = 0; i < 10; i++) h.sessions.images(h.location, store => store.begin(randomUUID(), 'x.png', 1, 'a'.repeat(64)));
  assert.throws(() => h.sessions.images(h.location, store => store.begin(randomUUID(), 'x.png', 1, 'a'.repeat(64))), /Too many/);
});

test('image bytes use a separate budget without exempting ordinary text or tool arguments', () => {
  const image = { type: 'input_image', image_url: `data:image/png;base64,${'a'.repeat(9 * 1024 * 1024)}` };
  assert.equal(fitsInputBudget([{ role: 'user', content: [image] }]), true);
  assert.equal(fitsInputBudget([{ role: 'user', content: [{ type: 'input_text', text: 'a'.repeat(9 * 1024 * 1024) }] }]), false);
  assert.equal(fitsInputBudget([{ type: 'function_call', image_url: image.image_url }]), false);
  assert.equal(fitsInputBudget([{ role: 'user', content: [{ ...image, image_url: `data:image/png;base64,${'a'.repeat(64 * 1024 * 1024)}` }] }]), false);
});
