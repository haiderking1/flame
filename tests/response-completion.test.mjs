import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { SessionDatabase } from '../dist/backend/sessions/database.js';

const settings = { modelId: 'fixture', effort: null, serviceTier: 'default' };
const request = { accountId: 'fixture', access: 'fixture-secret', sessionId: randomUUID(), settings, input: [] };
const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A real reply.', annotations: [] }] };
const reasoning = { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'opaque-context' };
const item = (output_index, item) => ({ type: 'response.output_item.done', output_index, item });
const terminal = (type = 'response.completed', response = { status: 'completed', output: [] }) => ({ type, response });
function run(events, suffix = '\n\n') {
  const wire = events.map((event) => `data: ${JSON.stringify(event)}`).join('\r\n\r\n') + suffix;
  const client = new CodexInferenceClient(async () => {
    const bytes = new TextEncoder().encode(wire);
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    } }), { headers: { 'content-type': 'application/octet-stream' } });
  });
  return client.run(request, () => {}, new AbortController().signal);
}

test('item completion events retain assistant text and reasoning when terminal output is empty or omitted', async () => {
  for (const output of [[], undefined, [reasoning]]) {
    const result = await run([item(1, message), item(0, reasoning), terminal('response.completed', { status: 'completed', output })]);
    assert.equal(result.text, 'A real reply.');
    assert.deepEqual(result.output, [reasoning, message]);
  }
});

test('terminal output enriches existing items without duplicating text or losing opaque reasoning', async () => {
  const result = await run([item(0, { ...reasoning, encrypted_content: undefined }), item(1, message),
    terminal('response.completed', { status: 'completed', output: [reasoning, message] })]);
  assert.equal(result.text, 'A real reply.'); assert.deepEqual(result.output, [reasoning, message]);
  const sparse = await run([item(0, reasoning), terminal('response.completed', { status: 'completed', output: [message] })]);
  assert.deepEqual(sparse.output, [reasoning, message]);
});

test('explicit success can finalize actual deltas even when the terminal event contains metadata only', async () => {
  for (const type of ['response.completed', 'response.done']) {
    for (const response of [{ status: 'completed' }, { status: 'completed', output: [] }, {}]) {
      const result = await run([{ type: 'response.output_text.delta', delta: 'Hi 🌍' }, terminal(type, response)]);
      assert.equal(result.text, 'Hi 🌍');
      assert.equal(result.output[0].content[0].text, 'Hi 🌍');
    }
  }
});

test('EOF flushes the final SSE frame but does not itself establish completion', async () => {
  for (const suffix of ['', '\n', '\r\n', '\r\n\r\n']) {
    const result = await run([item(0, message), terminal('response.done')], suffix);
    assert.equal(result.text, 'A real reply.');
  }
  for (const suffix of ['', '\n']) {
    await assert.rejects(run([item(0, message)], suffix), /before OpenAI confirmed completion/);
    await assert.rejects(run([{ type: 'response.output_text.delta', delta: 'Partial' }], suffix), /before OpenAI confirmed completion/);
  }
});

test('completed items do not hide failed, incomplete, malformed or empty terminal responses', async () => {
  for (const end of [
    { type: 'response.failed', response: { status: 'failed' } },
    { type: 'response.incomplete', response: { status: 'incomplete' } },
    terminal('response.done', { status: 'failed' }), terminal('response.completed', { status: 'in_progress' }),
    terminal('response.completed', null), terminal('response.completed', 'invalid'),
    terminal('response.completed', { status: 'completed', output: 'invalid' }),
  ]) await assert.rejects(run([item(0, message), end]));
  await assert.rejects(run([terminal()]), /without an assistant message/);
  await assert.rejects(run([item(-1, message), terminal()]), /invalid output index/);
  await assert.rejects(run([item(0, { type: 'function_call' }), terminal()]), /unsupported response item/);
});

test('startup repairs only the proven legacy false-completion error, without replacing text or replaying turns', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flame-completion-repair-'));
  let db;
  t.after(() => { db?.close(); rmSync(root, { recursive: true, force: true }); });
  const file = join(root, 'session.sqlite'); writeFileSync(file, '', { mode: 0o600 });
  const location = { projectId: randomUUID(), sessionId: randomUUID() };
  db = new SessionDatabase(file, location, settings);
  const add = (text, error) => {
    const id = randomUUID();
    db.turns.start(db.read().revision, id, 'Hello', settings);
    db.turns.finish(id, 'failed', text, error);
    return id;
  };
  const oldError = 'OpenAI finished without an assistant message.';
  const repaired = add('Saved reply', oldError);
  const realFailure = add('Partial', 'The connection ended before OpenAI confirmed completion.');
  const empty = add('\n\t', oldError);
  const before = db.read();
  db.turns.recover();
  assert.equal(db.turns.snapshot(repaired).status, 'completed');
  assert.equal(db.turns.snapshot(repaired).message, null);
  assert.equal(db.turns.snapshot(repaired).text, 'Saved reply');
  assert.equal(db.turns.snapshot(realFailure).status, 'failed');
  assert.equal(db.turns.snapshot(empty).status, 'failed');
  assert.equal(db.read().revision, before.revision + 1);
  const after = db.read(); db.turns.recover(); assert.deepEqual(db.read(), after, 'repair is idempotent');
  assert.equal(db.history(null).entries.find((entry) => entry.text === 'Saved reply').turnStatus, 'completed');
});
