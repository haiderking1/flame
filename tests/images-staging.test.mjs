import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileHarness } from './helpers/fileTools.mjs';
import { png } from './helpers/images.mjs';
import { ImageStaging, STAGING_TTL_MS } from '../dist/backend/images/staging.js';
import { Images } from '../dist/backend/images/service.js';
import { normalizeImage } from '../dist/backend/images/normalize.js';
import { hashImage } from '../dist/backend/images/files.js';
import { MAX_IMAGE_BYTES } from '../dist/contracts/image-types.js';
import { parseImageUpload } from '../dist/backend/images/http.js';

const opts = { skip: process.platform === 'win32' };
function setup(t, now) {
  const h = fileHarness(t, false);
  const draft = { ...h.location, sessionId: randomUUID() }, stageRoot = join(h.root, 'image-uploads');
  const staging = new ImageStaging(stageRoot, location => h.repository.assertUploadTarget(location), now);
  const images = new Images(h.sessions, staging); t.after(() => images.close());
  const data = png(7, 5);
  const value = (target = draft, id = randomUUID()) => ({ ...target, id, name: 'reference.png', bytes: data.length, sha256: hashImage(data) });
  const body = async function* (bytes = data) { yield bytes.subarray(0, 13); yield bytes.subarray(13); };
  const upload = value => images.upload(value, body(), new AbortController().signal);
  return { ...h, draft, staging, stageRoot, images, data, value, body, upload };
}

test('binary image staging prepares privately on attach without creating a project-draft session', opts, async t => {
  const h = setup(t), value = h.value(), info = await h.upload(value);
  assert.equal(h.sessions.snapshot().sessions.length, 1);
  assert.ok(!existsSync(join(h.root, 'projects', value.projectId, 'sessions', value.sessionId)));
  assert.deepEqual(h.images.staged(h.draft, [value.id]), [info]);
  const path = join(h.stageRoot, value.projectId, value.sessionId, `${value.id}.original`);
  assert.deepEqual(readFileSync(path), h.data); assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(h.stageRoot, value.projectId, value.sessionId)).mode & 0o777, 0o700);
  const restored = new ImageStaging(h.stageRoot, location => h.repository.assertUploadTarget(location));
  assert.deepEqual(restored.ready(h.draft, value.id), info);
  assert.deepEqual(Buffer.from(h.images.read(h.draft, value.id, 0).data, 'base64'), h.data);
  const files = readdirSync(join(h.stageRoot, value.projectId, value.sessionId));
  assert.ok(files.every(file => !file.endsWith('.upload') && !file.endsWith('.metadata')));
});

test('ready retries are verified and idempotent, descriptors and body hashes cannot change', opts, async t => {
  const h = setup(t), value = h.value(), first = await h.upload(value);
  assert.deepEqual(await h.upload(value), first);
  assert.throws(() => h.images.upload({ ...value, name: 'changed.png' }, h.body(), new AbortController().signal), /another attachment/);
  await assert.rejects(h.images.upload(value, h.body(Buffer.alloc(value.bytes)), new AbortController().signal), /checksum or size/);
  assert.deepEqual(h.staging.ready(h.draft, value.id), first, 'a malformed retry does not damage its already ready image');
  assert.throws(() => h.images.upload({ ...value, bytes: MAX_IMAGE_BYTES + 1 }, h.body(), new AbortController().signal), /20 MiB/);
  assert.throws(() => h.images.upload({ ...value, projectId: randomUUID() }, h.body(), new AbortController().signal), /no longer exists/);
  assert.throws(() => h.images.upload({ ...value, sessionId: '../escape' }, h.body(), new AbortController().signal), /Invalid/);
});

test('partial, excessive and stalled uploads release their slots and retry safely without a removed-ID resurrection', opts, async t => {
  const h = setup(t), value = h.value();
  await assert.rejects(h.images.upload(value, (async function* () { yield h.data.subarray(0, 8); })(), new AbortController().signal), /checksum or size/);
  assert.equal(h.staging.ready(h.draft, value.id), null);
  await assert.rejects(h.images.upload(value, (async function* () { yield Buffer.alloc(value.bytes + 1); })(), new AbortController().signal), /declared size/);
  const gate = { [Symbol.asyncIterator]() { return { next() { return new Promise(() => {}); }, return() { return Promise.resolve({ done: true }); } }; } };
  const controller = new AbortController(), pending = h.images.upload(value, gate, controller.signal);
  controller.abort(); await assert.rejects(pending);
  assert.deepEqual(await h.upload(value), h.staging.ready(h.draft, value.id));
  const removed = h.value(); h.images.discard(h.draft, removed.id);
  assert.throws(() => h.upload(removed), /attachment was removed/);
  const racing = h.value(), work = h.images.upload(racing, gate, new AbortController().signal);
  h.images.discard(h.draft, racing.id); await assert.rejects(work);
  assert.equal(h.staging.ready(h.draft, racing.id), null);
  assert.throws(() => h.upload(racing), /attachment was removed/);
  assert.equal(readdirSync(join(h.stageRoot, value.projectId, value.sessionId)).some(name => name.endsWith('.upload')), false);
});

test('three binary transfers may run concurrently and shutdown cancels a stalled body', opts, async t => {
  const h = setup(t);
  const gate = { [Symbol.asyncIterator]() { return { next() { return new Promise(() => {}); }, return() { return Promise.resolve({ done: true }); } }; } };
  const uploads = Array.from({ length: 3 }, () => h.images.upload(h.value(), gate, new AbortController().signal));
  const results = uploads.map(task => task.catch(() => null));
  assert.throws(() => h.images.upload(h.value(), gate, new AbortController().signal), /Three images/);
  await h.images.close(); assert.deepEqual(await Promise.all(results), [null, null, null]);
});

test('adoption is atomic, skips decoding and remains retryable after failed metadata commit', opts, async t => {
  const h = setup(t), a = h.value(), b = h.value();
  const infos = await Promise.all([h.upload(a), h.upload(b)]);
  h.sessions.create(h.draft);
  const filename = join(h.root, 'projects', h.draft.projectId, 'sessions', h.draft.sessionId, 'session.sqlite');
  const raw = new DatabaseSync(filename);
  raw.exec("CREATE TRIGGER fail_adopt BEFORE INSERT ON images BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  assert.throws(() => h.images.adopt(h.draft, [a.id, b.id]));
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM images').get().count, 0);
  assert.deepEqual(h.images.staged(h.draft, [a.id, b.id]), infos, 'staging remains intact after rollback');
  raw.exec('DROP TRIGGER fail_adopt');
  h.images.adopt(h.draft, [a.id, b.id]); h.images.adopt(h.draft, [a.id, b.id]);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM images').get().count, 2);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM image_chunks').get().count, 0);
  assert.deepEqual(h.images.staged(h.draft, [a.id, b.id]), infos, 'verification falls back to adopted session images');
  assert.equal(h.staging.ready(h.draft, a.id), null);
  for (const info of infos) {
    const path = join(h.root, 'projects', h.draft.projectId, 'sessions', h.draft.sessionId, 'images', `${info.id}.original`);
    assert.equal(statSync(path).nlink, 1); assert.equal(hashImage(readFileSync(path)), info.sha256);
  }
  raw.close();
});

test('adoption rejects missing and tampered artifacts while keeping originals recoverable', opts, async t => {
  const h = setup(t), value = h.value(); await h.upload(value); h.sessions.create(h.draft);
  assert.throws(() => h.images.adopt(h.draft, [value.id, randomUUID()]), /no longer available/);
  assert.equal(h.sessions.images(h.draft, store => store.info(value.id)), null);
  const path = join(h.stageRoot, value.projectId, value.sessionId, `${value.id}.model`);
  const original = readFileSync(path); writeFileSync(path, Buffer.alloc(original.length)); chmodSync(path, 0o600);
  assert.throws(() => h.images.adopt(h.draft, [value.id]), /unavailable or changed/);
  writeFileSync(path, original); chmodSync(path, 0o600);
  const foreign = join(h.root, 'same-image.model'); writeFileSync(foreign, original, { mode: 0o600 });
  unlinkSync(path); symlinkSync(foreign, path);
  assert.throws(() => h.images.adopt(h.draft, [value.id]), /symbolic link|ELOOP/);
  unlinkSync(path); writeFileSync(path, original, { mode: 0o600 });
  h.images.adopt(h.draft, [value.id]);
  assert.ok(h.sessions.images(h.draft, store => store.info(value.id)));
});

test('adoption resumes matching legacy chunk uploads atomically, preserving chunks on rollback and quota without double counting', opts, async t => {
  const h = setup(t), value = h.value(h.location);
  h.sessions.images(h.location, store => {
    store.begin(value.id, value.name, value.bytes, value.sha256);
    store.chunk(value.id, 0, h.data.subarray(0, 13).toString('base64'));
    for (let index = 0; index < 9; index++) store.begin(randomUUID(), value.name, value.bytes, value.sha256);
  });
  await h.upload(value);
  const filename = join(h.root, 'projects', h.location.projectId, 'sessions', h.location.sessionId, 'session.sqlite');
  const raw = new DatabaseSync(filename);
  raw.exec("CREATE TRIGGER fail_adopt BEFORE INSERT ON images BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  assert.throws(() => h.images.adopt(h.location, [value.id]));
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM image_uploads').get().count, 10);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM image_chunks WHERE id=?').get(value.id).count, 1);
  raw.exec('DROP TRIGGER fail_adopt');
  h.images.adopt(h.location, [value.id]);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM image_uploads').get().count, 9);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM image_chunks WHERE id=?').get(value.id).count, 0);
  assert.ok(h.sessions.images(h.location, store => store.info(value.id)));
  const collision = h.value(h.location); await h.upload(collision);
  raw.prepare('UPDATE image_uploads SET id=?,name=? WHERE id=(SELECT id FROM image_uploads LIMIT 1)').run(collision.id, 'other.png');
  assert.throws(() => h.images.adopt(h.location, [collision.id]), /different attachment/);
  assert.ok(h.staging.ready(h.location, collision.id)); raw.close();
});

test('a post-commit staging cleanup failure does not report adoption failure or divert adopted reads', opts, async t => {
  const h = setup(t), value = h.value(); await h.upload(value); h.sessions.create(h.draft);
  h.staging.discard = () => { throw new Error('simulated cleanup failure'); };
  h.images.adopt(h.draft, [value.id]); h.images.adopt(h.draft, [value.id]);
  assert.equal(h.sessions.snapshot().warnings.filter(message => message.includes('temporary image-upload')).length, 1);
  h.staging.read = () => { throw new Error('adopted read should use real store'); };
  assert.deepEqual(Buffer.from(h.images.read(h.draft, value.id, 0).data, 'base64'), h.data);
});

test('staged files and descriptors expire, removal tombstones survive restart and capacity ignores removed entries', opts, async t => {
  let now = Date.now(); const h = setup(t, () => now), value = h.value(); await h.upload(value);
  const removed = h.value(); h.images.discard(h.draft, removed.id);
  const restarted = new ImageStaging(h.stageRoot, location => h.repository.assertUploadTarget(location), () => now);
  assert.throws(() => restarted.claim(removed), /attachment was removed/);
  for (let count = 0; count < 9; count++) h.staging.claim(h.value());
  assert.throws(() => h.staging.claim(h.value()), /at most 10 images/);
  now += STAGING_TTL_MS + 1; restarted.cleanup();
  assert.equal(restarted.ready(h.draft, value.id), null);
  assert.equal(readdirSync(join(h.stageRoot, value.projectId, value.sessionId)).length, 0);
  assert.equal(restarted.claim(removed).ready, null, 'tombstones expire after the same bounded staging lifetime');
});

test('deleted sessions fence upload commit and private staging rejects symlink or permissive replacement', opts, async t => {
  const h = setup(t), value = h.value(h.location);
  const claimed = h.staging.claim(value), prepared = await normalizeImage(h.data, new AbortController().signal);
  h.repository.remove(h.location, 0);
  assert.throws(() => h.staging.complete(value, h.data, prepared), /no longer exists/);
  const draftValue = h.value(); await h.upload(draftValue);
  const file = join(h.stageRoot, draftValue.projectId, draftValue.sessionId, `${draftValue.id}.json`);
  chmodSync(file, 0o644); assert.throws(() => h.staging.ready(h.draft, draftValue.id), /unsafe/); chmodSync(file, 0o600);
  const original = join(claimed.root, `${value.id}.json`); unlinkSync(file); symlinkSync(original, file);
  assert.throws(() => h.staging.ready(h.draft, draftValue.id));
});

test('HTTP metadata parsing accepts one binary request and rejects mismatched length or ambiguous parameters', () => {
  const value = { projectId: randomUUID(), sessionId: randomUUID(), id: randomUUID(), name: 'space + unicode 😎.png', bytes: 99, sha256: 'a'.repeat(64) };
  const params = new URLSearchParams(Object.entries(value).map(([key, value]) => [key, String(value)]));
  const url = `/images/upload?${params}`;
  assert.deepEqual(parseImageUpload(url, { 'content-type': 'application/octet-stream', 'content-length': '99' }), value);
  assert.throws(() => parseImageUpload(url, { 'content-type': 'application/json' }), /binary/);
  assert.throws(() => parseImageUpload(url, { 'content-type': 'application/octet-stream', 'content-length': '100' }), /Content-Length/);
  assert.throws(() => parseImageUpload(`${url}&id=${value.id}`, { 'content-type': 'application/octet-stream' }), /metadata/);
});
