import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { SessionDatabase } from '../dist/backend/sessions/database.js';
import { initializeSession } from '../dist/backend/sessions/schema.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { paragraphBoundary } from '../dist/backend/turns/paragraphs.js';

const settings = { modelId: 'fixture-model', effort: 'high', serviceTier: 'default' };
const account = { key: 'account', accountId: 'test-account-id', access: 'test-access-secret', epoch: 1 };
const result = (text) => ({ text, output: [{ type: 'reasoning', id: 'rs_test', encrypted_content: 'opaque-reasoning' },
  { type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }] });
const sse = (...values) => values.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
function response(text, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const request = { ...account, sessionId: randomUUID(), settings, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }] };
function setup(t, client) {
  const root = mkdtempSync(join(tmpdir(), 'flame-turns-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(join(root, 'workspace'));
  const location = { projectId: project.id, sessionId: randomUUID() };
  const repository = new SessionRepository(join(root, 'projects'), projects);
  const models = { state: { selection: settings, accountKey: account.key }, validateSelection: (key, value) => {
    assert.equal(key, account.key); return value;
  } };
  const sessions = new Sessions(repository, models); sessions.create(location);
  const auth = new EventEmitter(); auth.session = account;
  auth.usageSession = () => auth.session;
  auth.refresh = async () => { throw new Error('A fresh token must not be refreshed unnecessarily'); };
  const turns = new Turns(sessions, auth, models, client);
  t.after(async () => { await turns.close(); projects.close(); rmSync(root, { recursive: true, force: true }); });
  const input = (text = 'Hello') => ({ ...location, revision: sessions.read(location).revision, requestId: randomUUID(), text, accountKey: account.key });
  return { root, location, repository, sessions, auth, models, turns, input };
}
async function finished(h) {
  for (let i = 0; i < 200; i++) { const turn = h.turns.snapshot(h.location); if (turn && turn.status !== 'running') return turn; await delay(10); }
  assert.fail('Turn never finished');
}

test('paragraph delivery holds incomplete prose, headings and code fences, including nested and mismatched fences', () => {
  assert.equal(paragraphBoundary('Hello'), 0);
  assert.equal(paragraphBoundary('Hello\n\npartial'), 7);
  assert.equal(paragraphBoundary('# Title\n\n'), 0);
  assert.equal(paragraphBoundary('# Title\n\nBody\n\nrest'), 15);
  assert.equal(paragraphBoundary('```ts\na\n\nb\n'), 0);
  assert.equal(paragraphBoundary('```ts\na\n~~~\n'), 0);
  assert.equal(paragraphBoundary('```ts\na\n```x\n'), 0);
  assert.equal(paragraphBoundary('```ts\na\n```\nrest'), 12);
  assert.equal(paragraphBoundary('    ```ts\na\n\n    ```\nrest'), '    ```ts\na\n\n    ```\n'.length);
  assert.equal(paragraphBoundary('- First\n- Second'), 8);
  assert.equal(paragraphBoundary('Hello\r\n\r\npartial'), 9);
});

test('Codex transport uses backend credentials, preserves reasoning, supports split UTF-8/SSE and maps explicit Fast', async () => {
  let body, headers, calls = 0;
  const client = new CodexInferenceClient(async (url, options) => {
    calls++; assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(options.redirect, 'error'); body = JSON.parse(options.body); headers = options.headers;
    return response(sse({ type: 'response.output_text.delta', delta: 'Hi 🌍' },
      { type: 'response.completed', response: { status: 'completed', output: result('Hi 🌍').output } }), 1);
  });
  let text = '';
  const saved = await client.run(request, (delta) => { text += delta; }, new AbortController().signal);
  assert.equal(text, 'Hi 🌍'); assert.equal(saved.text, text);
  assert.equal(saved.output[0].encrypted_content, 'opaque-reasoning');
  assert.equal(headers.Authorization, 'Bearer test-access-secret'); assert.equal(headers['ChatGPT-Account-Id'], account.accountId);
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.model, settings.modelId);
  assert.equal(body.reasoning.effort, 'high'); assert.equal(body.service_tier, undefined);
  assert.ok(!JSON.stringify(body).includes(account.access));
  await client.run({ ...request, settings: { ...settings, serviceTier: 'priority' } }, () => {}, new AbortController().signal);
  assert.equal(body.service_tier, 'priority'); assert.equal(calls, 2);
});

test('Codex event framing is authoritative even when Content-Type is missing or nonstandard', async () => {
  const wire = sse({ type: 'response.output_text.delta', delta: 'Hello' },
    { type: 'response.completed', response: { status: 'completed', output: result('Hello').output } });
  for (const contentType of [null, 'application/octet-stream', 'text/plain', 'Text/Event-Stream; charset=utf-8']) {
    let calls = 0;
    const client = new CodexInferenceClient(async () => {
      calls++;
      const reply = response(wire, 1);
      if (contentType === null) reply.headers.delete('content-type');
      else reply.headers.set('content-type', contentType);
      return reply;
    });
    let text = '';
    const saved = await client.run(request, (delta) => { text += delta; }, new AbortController().signal);
    assert.equal(saved.text, 'Hello'); assert.equal(text, 'Hello'); assert.equal(calls, 1);
  }
  for (const reply of [new Response(null, { status: 204 }), new Response('<html>secret proxy body</html>'), Response.json({ secret: 'not a response' })]) {
    let calls = 0;
    const client = new CodexInferenceClient(async () => { calls++; return reply; });
    await assert.rejects(client.run(request, () => assert.fail('Invalid bodies must not publish text'), new AbortController().signal),
      (error) => !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('transport never retries failures or exposes provider bodies, and requires explicit completion', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    let calls = 0;
    const client = new CodexInferenceClient(async () => { calls++; return new Response('secret provider detail', { status }); });
    await assert.rejects(client.run(request, () => {}, new AbortController().signal), (error) => !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
  for (const wire of [sse({ type: 'response.output_text.delta', delta: 'partial' }), 'data: {bad json}\n\n',
    sse({ type: 'response.failed', response: { error: { message: 'secret' } } }),
    sse({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call' }] } })]) {
    const client = new CodexInferenceClient(async () => response(wire));
    await assert.rejects(client.run(request, () => {}, new AbortController().signal), (error) => !error.message.includes('secret'));
  }
});

test('turns commit once, preserve full context and hide opaque provider output from public snapshots', async (t) => {
  const requests = [];
  const h = setup(t, { run: async (input, onText) => { requests.push(input); onText('Answer.'); return result('Answer.'); } });
  const input = h.input();
  const saved = await h.turns.start(input);
  const done = await finished(h);
  assert.equal(done.status, 'completed'); assert.ok(done.revision > saved.revision);
  await h.turns.start(input);
  assert.equal(requests.length, 1);
  await assert.rejects(h.turns.start({ ...input, text: 'different' }), /already belongs/);
  assert.deepEqual(h.sessions.history(h.location, null).entries.map((entry) => entry.kind), ['user', 'assistant']);
  assert.ok(!JSON.stringify(done).includes('opaque-reasoning'));
  await h.turns.start(h.input('Follow up')); await finished(h);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].input.some((entry) => entry.encrypted_content === 'opaque-reasoning'));
  assert.equal(requests[1].input.at(-1).content[0].text, 'Follow up');
  assert.ok(!JSON.stringify(h.sessions.turns(h.location, (store) => store.context(settings, 'another-account'))).includes('opaque-reasoning'));
  assert.ok(!JSON.stringify(h.sessions.turns(h.location, (store) => store.context({ ...settings, modelId: 'other-model' }, account.key))).includes('opaque-reasoning'));
});

test('one active turn per session, checkpointed paragraphs, explicit stop and no replay after cancellation', async (t) => {
  let calls = 0;
  const h = setup(t, { run: async (input, onText, signal) => {
    calls++; onText('Ready paragraph.\n\nIncomplete');
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const input = h.input(); await h.turns.start(input); await delay(450);
  assert.equal(h.turns.snapshot(h.location).text, 'Ready paragraph.\n\n');
  await assert.rejects(h.turns.start(h.input('Concurrent')), /Stop the active/);
  const doc = h.sessions.read(h.location);
  assert.throws(() => h.sessions.configure(h.location, doc.revision, account.key, settings), /Stop the active/);
  assert.throws(() => h.sessions.remove(h.location, doc.revision), /Stop the active/);
  h.turns.stop(h.location, input.requestId);
  const done = await finished(h); assert.equal(done.status, 'cancelled');
  assert.equal(done.text, 'Ready paragraph.\n\nIncomplete');
  await h.turns.start(input); assert.equal(calls, 1);
});

test('account changes abort in-flight work and reject stale-account submissions', async (t) => {
  const h = setup(t, { run: async (input, onText, signal) => {
    onText('Partial'); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await h.turns.start(h.input()); await delay(0);
  h.auth.session = { ...account, key: 'other-account', epoch: 2 }; h.auth.emit('change');
  assert.equal((await finished(h)).status, 'cancelled');
  await assert.rejects(h.turns.start(h.input()), /Account changed/);
});

test('startup recovers persisted unfinished turns without making a provider request', async (t) => {
  let calls = 0;
  const h = setup(t, { run: async () => { calls++; return result('Unexpected'); } });
  await h.turns.close();
  const input = h.input();
  h.sessions.turns(h.location, (store) => { store.start(input.revision, input.requestId, input.text, settings); store.checkpoint(input.requestId, 'Durable paragraph.\n\n'); });
  const restarted = new Turns(h.sessions, h.auth, h.models, { run: async () => { calls++; return result('Unexpected'); } });
  assert.equal(restarted.snapshot(h.location).status, 'interrupted');
  assert.equal(restarted.snapshot(h.location).text, 'Durable paragraph.\n\n');
  await restarted.start(input); assert.equal(calls, 0);
  assert.deepEqual(h.sessions.history(h.location, null).entries.map((entry) => entry.kind), ['user', 'assistant']);
  await restarted.close();
});

test('migration preserves v1 IDs, metadata, drafts, settings and references', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flame-session-migration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'session.sqlite'); writeFileSync(file, '', { mode: 0o600 });
  const location = { projectId: randomUUID(), sessionId: randomUUID() };
  const raw = new DatabaseSync(file); initializeSession(raw, location, settings);
  const id = randomUUID(); raw.prepare("INSERT INTO entries VALUES (?,NULL,1,'user','Old message',?,?)").run(id, JSON.stringify(settings), randomUUID());
  raw.prepare("UPDATE session SET leaf_id=?,draft='Old draft',revision=7").run(id); raw.close();
  const migrated = new SessionDatabase(file, location);
  assert.equal(migrated.read().revision, 7); assert.equal(migrated.read().draft, 'Old draft'); assert.equal(migrated.read().leafId, id);
  assert.equal(migrated.history(null).entries[0].text, 'Old message'); migrated.close();
  const check = new DatabaseSync(file);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 7); assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []); check.close();
});
