import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, readFileSync, unlinkSync, symlinkSync, truncateSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as photon from '@silvia-odwyer/photon-node';
import { fileHarness, tool, settings, account } from './helpers/fileTools.mjs';
import { png } from './helpers/images.mjs';
import { FileTools } from '../dist/backend/file-tools/service.js';
import { hashImage } from '../dist/backend/images/files.js';
import { preparationQueue } from '../dist/backend/images/preparation-queue.js';
import { normalizeImage } from '../dist/backend/images/normalize.js';
import { MAX_IMAGE_BYTES } from '../dist/contracts/image-types.js';

const opts = { skip: process.platform === 'win32', timeout: 15000 };
const signal = () => new AbortController().signal;
const imageRoot = h => join(h.root, 'projects', h.location.projectId, 'sessions', h.location.sessionId, 'images');
function storedBytes(h, id) {
  const chunks = []; let offset = 0;
  for (;;) { const chunk = h.sessions.images(h.location, store => store.read(id, offset)); chunks.push(Buffer.from(chunk.data, 'base64')); if (chunk.next === null) return Buffer.concat(chunks); offset = chunk.next; }
}

test('Read supports PNG/JPEG/WebP/GIF pixels, detects bytes without an extension, and retains normal text pagination', opts, async t => {
  const h = fileHarness(t), source = png(3, 2), image = photon.PhotonImage.new_from_byteslice(source);
  let jpeg, webp;
  try { jpeg = image.get_bytes_jpeg(90); webp = image.get_bytes_webp(); } finally { image.free(); }
  const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
  for (const [name, bytes, mime] of [['pixels', source, 'image/png'], ['reference.JPG', jpeg, 'image/jpeg'], ['reference.webp', webp, 'image/webp'], ['reference.gif', gif, 'image/gif']]) {
    writeFileSync(join(h.work, name), bytes);
    const result = await h.execute('read', { path: name, offset: 100, limit: 1 });
    assert.equal(result.status, 'completed', result.error); assert.equal(result.image.mimeType, mime);
    assert.equal(result.sha256, hashImage(bytes)); assert.equal(result.content, undefined); assert.equal(result.next_offset, undefined);
    const output = h.files.modelOutput(h.location, JSON.stringify(result));
    assert.equal(output.filter(part => part.type === 'input_image').length, 1); assert.equal(output.at(-1).detail, 'auto');
    assert.match(output.at(-1).image_url, /^data:image\/(png|jpeg);base64,/);
    assert.ok(!JSON.stringify(result).includes('base64,'));
  }
  writeFileSync(join(h.work, 'text'), '\uFEFFone\r\ntwø\r\nthree\r\n');
  const text = await h.execute('read', { path: 'text', limit: 2 });
  assert.equal(text.content, 'one\ntwø'); assert.equal(text.next_offset, 3); assert.equal(text.image, undefined);
  assert.equal(typeof h.files.modelOutput(h.location, JSON.stringify(text)), 'string');
});

test('Read preserves original bytes and bounded model snapshots across call replay, file deletion, recovery, and scope changes', opts, async t => {
  const h = fileHarness(t), source = png(2100, 100), path = join(h.work, 'screen.png'); writeFileSync(path, source);
  symlinkSync(path, join(h.work, 'alias'));
  const call = tool('read', { path: 'alias', offset: null, limit: null });
  h.sessions.turns(h.location, store => store.progress(h.turnId, '', [call]));
  const result = await h.files.execute(h.location, h.turnId, call, signal());
  assert.equal(result.status, 'completed', result.error); assert.equal(result.image.width, 2100); assert.equal(result.image.modelWidth, 2000);
  const original = join(imageRoot(h), `${result.image.id}.original`);
  assert.deepEqual(readFileSync(original), source); assert.deepEqual(storedBytes(h, result.image.id), source);
  unlinkSync(path);
  const recovered = new FileTools(h.sessions, () => h.work);
  assert.deepEqual(await recovered.execute(h.location, h.turnId, call, signal()), result, 'same call returns the stored snapshot, never rereads the source');
  const live = h.sessions.turns(h.location, store => store.snapshot());
  assert.equal(live.activity.steps[0].file.image.id, result.image.id); assert.ok(!JSON.stringify(live).includes('base64,'));
  h.sessions.turns(h.location, store => store.finish(h.turnId, 'completed', 'Saw screenshot', null, [call]));
  const context = h.sessions.turns(h.location, store => store.context(settings, account.key));
  const output = context.find(item => item.type === 'function_call_output');
  assert.equal(output.call_id, call.call_id); assert.equal(output.output.at(-1).type, 'input_image');
  const portable = h.sessions.turns(h.location, store => store.context({ ...settings, modelId: 'other' }, 'other-account'));
  assert.ok(portable.some(item => item.role === 'user' && item.content.some(part => part.type === 'input_image')));
  assert.ok(!portable.some(item => item.type === 'function_call' || item.type === 'function_call_output'));
  assert.ok(!portable.some(item => item.content?.some(part => part.type === 'input_text' && part.text.includes('base64,'))));
  assert.equal(h.sessions.history(h.location, null).entries.at(-1).activity.steps[0].file.image.id, result.image.id);
  h.sessions.images(h.location, store => store.discard(result.image.id));
  assert.ok(h.sessions.images(h.location, store => store.info(result.image.id)), 'draft cleanup cannot delete a Read snapshot');
  assert.throws(() => h.sessions.append(h.location, h.sessions.read(h.location).revision, randomUUID(), 'not an attachment', [result.image.id]), /saved Read result/);
  for (let index = 0; index < 10; index++) h.sessions.images(h.location, store => store.begin(randomUUID(), `draft-${index}.png`, 1, 'a'.repeat(64)));
  assert.throws(() => h.sessions.images(h.location, store => store.begin(randomUUID(), 'full.png', 1, 'a'.repeat(64))), /Too many/, 'Read images never use draft upload slots');
});

test('Read rejects malformed, oversized, unsupported binary, and known text-only image reads without publishing assets', opts, async t => {
  const h = fileHarness(t);
  for (const [name, bytes, message] of [['broken.png', Buffer.from('not a PNG'), /valid PNG/], ['bad.webp', Buffer.from('RIFF'), /valid PNG/], ['binary', Buffer.from([0xff, 0xfe, 0]), /UTF-8/]]) {
    writeFileSync(join(h.work, name), bytes);
    const result = await h.execute('read', { path: name }); assert.equal(result.status, 'failed'); assert.match(result.error, message); assert.equal(result.image, undefined);
  }
  writeFileSync(join(h.work, 'huge.png'), ''); truncateSync(join(h.work, 'huge.png'), MAX_IMAGE_BYTES + 1);
  assert.match((await h.execute('read', { path: 'huge.png' })).error, /20 MiB/);
  const giant = png(); giant.writeUInt32BE(100000, 16); writeFileSync(join(h.work, 'dimensions.png'), giant);
  assert.match((await h.execute('read', { path: 'dimensions.png' })).error, /megapixel/);
  writeFileSync(join(h.work, 'valid.png'), png());
  const result = await h.files.execute(h.location, h.turnId, tool('read', { path: 'valid.png' }), signal(), false);
  assert.equal(result.status, 'failed'); assert.match(result.error, /does not accept images/);
  assert.equal(existsSync(imageRoot(h)), false, 'failed reads publish no private image files');
});

test('image outcome persistence failure does not replay a completed Read, and corrupt private bytes are rejected', opts, async t => {
  const h = fileHarness(t); writeFileSync(join(h.work, 'screen.png'), png());
  const call = tool('read', { path: 'screen.png' }), originalFiles = h.sessions.files.bind(h.sessions);
  h.sessions.files = (location, work) => originalFiles(location, store => work(new Proxy(store, { get(target, key) {
    if (key === 'finish') return () => { throw new Error('Disk unavailable'); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  await assert.rejects(h.files.execute(h.location, h.turnId, call, signal()), /read-only.*result could not be saved/);
  h.sessions.files = originalFiles;
  const uncertain = await h.files.execute(h.location, h.turnId, call, signal()); assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.image, undefined);
  const saved = await h.execute('read', { path: 'screen.png' });
  writeFileSync(join(imageRoot(h), `${saved.image.id}.model`), Buffer.alloc(saved.image.modelBytes), { mode: 0o600 });
  assert.throws(() => h.files.modelOutput(h.location, JSON.stringify(saved)), /changed/);
});

test('Read image metadata, ownership and outcome roll back together when saving the result fails', opts, async t => {
  const h = fileHarness(t); writeFileSync(join(h.work, 'screen.png'), png());
  const filename = join(h.root, 'projects', h.location.projectId, 'sessions', h.location.sessionId, 'session.sqlite');
  const db = new DatabaseSync(filename);
  try { db.exec("CREATE TRIGGER fail_read_result BEFORE UPDATE OF result ON file_operations BEGIN SELECT RAISE(ABORT,'Disk unavailable'); END;"); }
  finally { db.close(); }
  const call = tool('read', { path: 'screen.png' });
  await assert.rejects(h.files.execute(h.location, h.turnId, call, signal()), /read-only.*result could not be saved/);
  const checked = new DatabaseSync(filename);
  try {
    assert.equal(checked.prepare('SELECT COUNT(*) AS count FROM images').get().count, 0);
    const row = checked.prepare('SELECT result,image_id FROM file_operations WHERE call_id=?').get(call.call_id);
    assert.equal(row.result, null); assert.equal(row.image_id, null);
  } finally { checked.close(); }
  assert.equal((await h.files.execute(h.location, h.turnId, call, signal())).status, 'uncertain');
});

test('uploads and tool reads share two preparation slots, and queued cancellation never starts a worker', opts, async () => {
  let releaseFirst, releaseSecond, queuedStarted = false;
  const first = preparationQueue.run(signal(), () => new Promise(resolve => { releaseFirst = resolve; }));
  const second = preparationQueue.run(signal(), () => new Promise(resolve => { releaseSecond = resolve; }));
  const controller = new AbortController();
  const queued = preparationQueue.run(controller.signal, async () => { queuedStarted = true; });
  controller.abort(); await assert.rejects(queued); assert.equal(queuedStarted, false);
  const cancelled = new AbortController(), normalized = normalizeImage(png(), cancelled.signal);
  cancelled.abort(); await assert.rejects(normalized);
  releaseFirst(); releaseSecond(); await Promise.all([first, second]);
  const normal = await normalizeImage(png(), signal()); assert.equal(normal.modelWidth, 2);
});
