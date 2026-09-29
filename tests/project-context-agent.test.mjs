import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileHarness, tool, account } from './helpers/fileTools.mjs';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { BashRuntime } from '../dist/backend/bash/service.js';
import { digest } from '../dist/backend/file-tools/filesystem.js';

const opts = { timeout: 10000, skip: process.platform === 'win32' };
const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
async function run(h, respond, requestId = h.turnId) {
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const requests = [];
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const output = await respond(body, requests.length);
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`);
  });
  const bash = new BashRuntime(h.sessions, () => h.work);
  const turns = new Turns(h.sessions, auth, h.models, client, bash, h.files);
  try {
    await turns.start({ ...h.location, revision: h.sessions.read(h.location).revision, requestId, text: 'Do the task', accountKey: account.key });
    for (let i = 0; i < 400; i++) {
      const snapshot = turns.snapshot(h.location);
      if (snapshot && snapshot.status !== 'running') return { snapshot, requests, jobs: bash.list(h.location) };
      await delay(10);
    }
    assert.fail('Instruction-aware turn did not finish');
  } finally { await turns.close(); bash.close(); }
}

test('root context is injected once; nested files use normal tools without auto-loading or deferring operations', opts, async t => {
  const h = fileHarness(t, false); mkdirSync(join(h.work, 'src'));
  writeFileSync(join(h.work, 'AGENTS.md'), 'ROOT_POLICY');
  writeFileSync(join(h.work, 'src', 'AGENTS.md'), 'NESTED_POLICY');
  const result = await run(h, (body, n) => {
    assert.ok(body.instructions.includes('ROOT_POLICY'));
    assert.ok(!body.instructions.includes('NESTED_POLICY'));
    assert.ok(!body.instructions.includes('checked_scope'));
    if (n === 1) return [tool('write', { path: 'src/new.txt', expected_sha256: null, content: 'created' }, 'write-file'),
      tool('bash', { command: 'printf ran > shell-marker', background: false }, 'shell-call')];
    assert.equal(readFileSync(join(h.work, 'src', 'new.txt'), 'utf8'), 'created');
    assert.equal(readFileSync(join(h.work, 'shell-marker'), 'utf8'), 'ran');
    const outputs = body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
    assert.ok(outputs.every(item => item.status !== 'deferred'));
    if (n === 2) return [tool('read', { path: 'src/AGENTS.md', offset: null, limit: null }, 'read-nested-rules')];
    assert.equal(outputs.at(-1).content, 'NESTED_POLICY', 'nested instructions remain available through an ordinary explicit Read');
    return [message('Done.')];
  });
  assert.equal(result.snapshot.status, 'completed'); assert.equal(result.requests.length, 3); assert.equal(result.jobs.length, 1);
  assert.ok(result.snapshot.activity.steps.every(step => !step.deferred));
  assert.equal(result.snapshot.activity.steps[0].file.status, 'completed');
  assert.ok(!JSON.stringify(result.snapshot).includes('ROOT_POLICY'), 'automatically loaded context is not copied into the public work envelope');
  assert.equal(h.sessions.history(h.location, null).entries.at(-1).activity.steps[0].file.status, 'completed');
});

test('instruction edits neither pause later tools nor hot-reload the current run prompt', opts, async t => {
  const h = fileHarness(t, false), original = 'OLD_POLICY'; writeFileSync(join(h.work, 'AGENTS.md'), original);
  const result = await run(h, (body, n) => {
    assert.ok(body.instructions.includes('OLD_POLICY')); assert.ok(!body.instructions.includes('NEW_POLICY'));
    if (n === 1) return [tool('write', { path: 'AGENTS.md', expected_sha256: digest(original), content: 'NEW_POLICY' }, 'update-rules'),
      tool('bash', { command: 'printf ran > after-instruction-edit', background: false }, 'shell-call')];
    assert.equal(readFileSync(join(h.work, 'after-instruction-edit'), 'utf8'), 'ran');
    return [message('Updated the instructions and ran the command.')];
  });
  assert.equal(result.snapshot.status, 'completed'); assert.equal(result.requests.length, 2); assert.equal(result.jobs.length, 1);
  const resumed = await run(h, body => {
    assert.ok(body.instructions.includes('NEW_POLICY')); assert.ok(!body.instructions.includes('OLD_POLICY'));
    return [message('The new run uses the saved instructions.')];
  }, randomUUID());
  assert.equal(resumed.snapshot.status, 'completed'); assert.equal(resumed.requests.length, 1);
});

test('a non-file override falls back to the ordinary instructions without stopping inference', opts, async t => {
  const h = fileHarness(t, false); mkdirSync(join(h.work, 'AGENTS.override.md')); writeFileSync(join(h.work, 'AGENTS.md'), 'FALLBACK_POLICY');
  const result = await run(h, body => {
    assert.ok(body.instructions.includes('FALLBACK_POLICY'));
    return [message('Done.')];
  });
  assert.equal(result.snapshot.status, 'completed'); assert.equal(result.requests.length, 1);
});
