import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileHarness, account } from './helpers/fileTools.mjs';
import { upload } from './helpers/images.mjs';
import { Images } from '../dist/backend/images/service.js';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';

async function finished(turns, location) {
  for (let i = 0; i < 400; i++) { const snapshot = turns.snapshot(location); if (snapshot && snapshot.status !== 'running') return snapshot; await delay(10); }
  assert.fail('Image turn did not finish');
}
const opts = { skip: process.platform === 'win32', timeout: 15000 };
test('actual Responses request receives normalized image pixels and reload/follow-up retains image context without replay', opts, async t => {
  const h = fileHarness(t, false), images = new Images(h.sessions), requests = [];
  const saved = await upload(h, images);
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const imageBlocks = body.input.flatMap(item => item.content ?? []).filter(part => part.type === 'input_image');
    assert.equal(imageBlocks.length, 1); assert.equal(imageBlocks[0].detail, 'auto');
    assert.ok(imageBlocks[0].image_url.startsWith('data:image/png;base64,'));
    assert.ok(body.input.some(item => item.role === 'user' && item.content.some(part => part.type === 'input_text' && part.text.includes('reference.png'))));
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I can see the attached image.' }] }] } })}\n\n`);
  });
  let turns = new Turns(h.sessions, auth, h.models, client);
  t.after(async () => { await turns.close(); await images.close(); });
  const input = { ...h.location, revision: 0, requestId: h.turnId, text: '', accountKey: account.key, images: [saved.id] };
  await turns.start(input);
  assert.equal((await finished(turns, h.location)).status, 'completed');
  await turns.start(input); assert.equal(requests.length, 1);
  assert.equal(h.sessions.history(h.location, null).entries[0].images[0].id, saved.id);
  assert.ok(!JSON.stringify(turns.snapshot(h.location)).includes('base64,'));
  await turns.close(); turns = new Turns(h.sessions, auth, h.models, client);
  await turns.start({ ...h.location, revision: h.sessions.read(h.location).revision, requestId: randomUUID(), text: 'Continue inspecting that image', accountKey: account.key });
  assert.equal((await finished(turns, h.location)).status, 'completed'); assert.equal(requests.length, 2);
});

test('known text-only models reject before accepting a message or calling provider, preserving attachments', opts, async t => {
  const h = fileHarness(t, false), images = new Images(h.sessions), saved = await upload(h, images);
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const turns = new Turns(h.sessions, auth, { ...h.models, supportsImages: () => false }, { run: () => assert.fail('No image must reach a text-only model') });
  t.after(async () => { await turns.close(); await images.close(); });
  await assert.rejects(turns.start({ ...h.location, revision: 0, requestId: h.turnId, text: '', accountKey: account.key, images: [saved.id] }), /does not accept images/);
  assert.equal(h.sessions.history(h.location, null).entries.length, 0);
  assert.equal(h.sessions.images(h.location, store => store.info(saved.id)).id, saved.id);
});

test('Stop after accepted image message cancels inference without discarding or resending its pixels', opts, async t => {
  const h = fileHarness(t, false), images = new Images(h.sessions), saved = await upload(h, images);
  const auth = new EventEmitter(); auth.usageSession = () => account;
  let began, calls = 0; const started = new Promise(resolve => { began = resolve; });
  const turns = new Turns(h.sessions, auth, h.models, { async run(_request, _onText, signal) {
    calls++; began(); await new Promise((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  } });
  t.after(async () => { await turns.close(); await images.close(); });
  const input = { ...h.location, revision: 0, requestId: h.turnId, text: '', accountKey: account.key, images: [saved.id] };
  await turns.start(input); await started; turns.stop(h.location, h.turnId);
  assert.equal((await finished(turns, h.location)).status, 'cancelled');
  await turns.start(input); assert.equal(calls, 1);
  assert.equal(h.sessions.history(h.location, null).entries[0].images[0].id, saved.id);
});
