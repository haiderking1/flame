import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileHarness, account, tool, settings } from './helpers/fileTools.mjs';
import { png } from './helpers/images.mjs';
import { completed, message, harness, isSummary, summary, until } from './helpers/compaction.mjs';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { hashImage } from '../dist/backend/images/files.js';
import { estimateTokens } from '../dist/backend/compaction/estimate.js';
import { serializeForSummary } from '../dist/backend/compaction/serialize.js';
import { fitsInputBudget } from '../dist/backend/turns/input-budget.js';

const opts = { skip: process.platform === 'win32', timeout: 20000 };
const done = (turns, location) => until(() => { const state = turns.snapshot(location); return state && state.status !== 'running' ? state : null; });
const imagesIn = input => input.flatMap(item => Array.isArray(item.output) ? item.output : item.content ?? []).filter(part => part.type === 'input_image');

test('actual Responses Read image output carries pixels and survives a backend restart and deleted source without replay', opts, async t => {
  const h = fileHarness(t, false), source = join(h.work, 'screen.png'); writeFileSync(source, png(640, 240));
  const call = tool('read', { path: 'screen.png', offset: null, limit: null }), requests = [], errors = [];
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    try {
      if (requests.length === 1) { assert.equal(imagesIn(body.input).length, 0); return completed([call]); }
      const pixels = imagesIn(body.input); assert.equal(pixels.length, 1); assert.equal(pixels[0].detail, 'auto');
      const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === call.call_id);
      assert.ok(Array.isArray(output.output));
      const info = JSON.parse(output.output[0].text).image;
      assert.equal(hashImage(Buffer.from(pixels[0].image_url.split(',')[1], 'base64')), info.modelSha256);
      assert.ok(fitsInputBudget(body.input));
      return completed([message('I can see the screenshot.')]);
    } catch (error) { errors.push(error); throw error; }
  });
  let turns = new Turns(h.sessions, auth, h.models, client, undefined, h.files); t.after(() => turns.close());
  const input = { ...h.location, revision: 0, requestId: h.turnId, text: 'Read screen.png', accountKey: account.key };
  await turns.start(input); const first = await done(turns, h.location);
  assert.equal(first.status, 'completed', errors[0]?.stack ?? first.message); assert.equal(requests.length, 2);
  assert.ok(first.activity.steps.find(step => step.kind === 'tool').file.image);
  assert.ok(!JSON.stringify(first).includes('base64,'));
  await turns.start(input); assert.equal(requests.length, 2);
  unlinkSync(source); await turns.close(); turns = new Turns(h.sessions, auth, h.models, client, undefined, h.files);
  await turns.start({ ...h.location, revision: h.sessions.read(h.location).revision, requestId: randomUUID(), text: 'What did that screenshot show?', accountKey: account.key });
  const resumed = await done(turns, h.location); assert.equal(resumed.status, 'completed', errors[0]?.stack ?? resumed.message); assert.equal(requests.length, 3);
});

test('known text-only models get a truthful Read failure instead of a silently omitted image', opts, async t => {
  const h = fileHarness(t, false); writeFileSync(join(h.work, 'screen.png'), png());
  const auth = new EventEmitter(); auth.usageSession = () => account;
  let calls = 0;
  const client = { async run(request) {
    calls++; assert.equal(imagesIn(request.input).length, 0);
    if (calls === 1) return { text: '', output: [tool('read', { path: 'screen.png' })] };
    const output = request.input.find(item => item.type === 'function_call_output');
    assert.equal(typeof output.output, 'string'); assert.match(JSON.parse(output.output).error, /does not accept images/);
    return { text: 'Choose an image-capable model.', output: [message('Choose an image-capable model.')] };
  } };
  const turns = new Turns(h.sessions, auth, { ...h.models, supportsImages: () => false }, client, undefined, h.files); t.after(() => turns.close());
  await turns.start({ ...h.location, revision: 0, requestId: h.turnId, text: 'Read the screenshot', accountKey: account.key });
  const state = await done(turns, h.location); assert.equal(state.status, 'completed', state.message); assert.equal(calls, 2);
  assert.equal(state.activity.steps.find(step => step.kind === 'tool').file.status, 'failed');
});

test('Stop after image Read preserves its saved pixels and never repeats the accepted request', opts, async t => {
  const h = fileHarness(t, false), path = join(h.work, 'screen.png'); writeFileSync(path, png());
  const auth = new EventEmitter(); auth.usageSession = () => account;
  let began, calls = 0; const following = new Promise(resolve => { began = resolve; });
  const client = { async run(request, _stream, signal) {
    calls++; if (calls === 1) return { text: '', output: [tool('read', { path: 'screen.png' })] };
    assert.equal(imagesIn(request.input).length, 1); began();
    await new Promise((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  } };
  const turns = new Turns(h.sessions, auth, h.models, client, undefined, h.files); t.after(() => turns.close());
  const input = { ...h.location, revision: 0, requestId: h.turnId, text: 'Inspect screenshot', accountKey: account.key };
  await turns.start(input); await following; turns.stop(h.location, h.turnId);
  const state = await done(turns, h.location); assert.equal(state.status, 'cancelled');
  assert.ok(state.activity.steps.find(step => step.kind === 'tool').file.image); unlinkSync(path);
  assert.equal(imagesIn(h.sessions.turns(h.location, store => store.context(settings, account.key))).length, 1);
  await turns.start(input); assert.equal(calls, 2);
});

test('compaction sees actual tool-image pixels, estimates visual tokens, and preserves the original Read preview', opts, async t => {
  let normalCalls = 0, summarizedPixels = 0;
  const h = harness(t, body => {
    if (isSummary(body)) {
      const pixels = imagesIn(body.input); summarizedPixels += pixels.length;
      assert.equal(pixels.length, 1); assert.match(pixels[0].image_url, /^data:image\/png;base64,/);
      assert.ok(!body.input[0].content.some(part => part.type === 'input_text' && part.text.includes('base64,')));
      return [message(summary)];
    }
    normalCalls++;
    if (normalCalls === 1) return [tool('read', { path: 'screen.png' })];
    assert.equal(imagesIn(body.input).length, 1); return [message('Saw the screenshot')];
  }, 80000);
  writeFileSync(join(h.work, 'screen.png'), png()); await h.start('Inspect screen.png');
  assert.equal((await h.done()).status, 'completed', h.transportErrors[0]?.stack);
  const saved = h.turns.snapshot(h.location).activity.steps.find(step => step.kind === 'tool').file.image;
  const capture = h.context(), output = capture.find(item => item.type === 'function_call_output');
  const estimate = estimateTokens([output]); assert.ok(estimate >= 8192); assert.ok(estimate < 12000);
  assert.equal(imagesIn([{ content: serializeForSummary([output]) }]).length, 1);
  for (let index = 0; index < 3; index++) h.seed(40000);
  await h.compact(); const compacted = await h.done();
  assert.equal(compacted.status, 'completed', h.transportErrors[0]?.stack ?? compacted.message); assert.equal(summarizedPixels, 1);
  assert.equal(h.checkpoints().length, 1); await h.restart();
  assert.equal(h.sessions.images(h.location, store => store.info(saved.id)).sha256, saved.sha256);
});

test('a retained tool-image compaction window reconstructs pixels after restart and model/account changes', opts, async t => {
  const h = fileHarness(t), call = tool('read', { path: 'screen.png' }); writeFileSync(join(h.work, 'screen.png'), png());
  const result = await h.files.execute(h.location, h.turnId, call, new AbortController().signal);
  h.sessions.turns(h.location, store => store.finish(h.turnId, 'completed', 'Saw screenshot', null, [call, { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) }]));
  const capture = h.sessions.compactions(h.location, store => store.capture(settings, account.key));
  h.sessions.compactions(h.location, store => store.save({ expectedLeafId: capture.leafId, previousId: null, summary,
    kept: capture.input, modelId: settings.modelId, accountKey: account.key, tokensBefore: 10000, tokensAfter: 9000, trigger: 'manual' }));
  unlinkSync(join(h.work, 'screen.png'));
  assert.equal(imagesIn(h.sessions.compactions(h.location, store => store.capture(settings, account.key)).input).length, 1);
  const switched = h.sessions.compactions(h.location, store => store.capture({ ...settings, modelId: 'other' }, 'other')).input;
  assert.equal(imagesIn(switched).length, 1); assert.ok(!switched.some(item => item.type === 'function_call_output'));
});
