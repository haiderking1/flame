import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileHarness, tool, settings, account } from './helpers/fileTools.mjs';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { BashRuntime } from '../dist/backend/bash/service.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { agentInstructions } from '../dist/backend/turns/instructions.js';

const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const opts = { timeout: 10000, skip: process.platform === 'win32' };
async function finished(turns, location) {
  for (let i = 0; i < 400; i++) {
    const snapshot = turns.snapshot(location);
    if (snapshot && snapshot.status !== 'running') return snapshot;
    await delay(10);
  }
  assert.fail('Agent did not finish');
}

test('real Responses parser runs ls/read/edit/write/Bash end to end, returns results to model, and persists public file activity', opts, async t => {
  const h = fileHarness(t, false), requests = [];
  writeFileSync(join(h.work, 'source.txt'), 'original\n');
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.deepEqual(body.tools.map(tool => tool.name), ['bash', 'bash_job', 'ls', 'read', 'edit', 'write']);
    assert.equal(body.parallel_tool_calls, false);
    assert.ok(body.instructions.endsWith(`<cwd>\n${h.work}\n</cwd>`));
    const result = id => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id).output);
    let items;
    switch (requests.length) {
      case 1:
        assert.ok(body.instructions.includes('Use ls for non-recursive directory discovery'));
        items = [{ type: 'reasoning', encrypted_content: 'PRIVATE_REASONING' }, tool('ls', { path: null, limit: null }, 'list-project')]; break;
      case 2:
        assert.equal(result('list-project').content, 'source.txt');
        assert.equal(result('list-project').entries, 1);
        items = [tool('read', { path: 'source.txt', offset: null, limit: null }, 'read-source')]; break;
      case 3:
        assert.equal(result('read-source').content, 'original');
        items = [tool('edit', { path: 'source.txt', expected_sha256: result('read-source').sha256, edits: [{ oldText: 'original', newText: 'edited' }] }, 'edit-source')]; break;
      case 4:
        assert.equal(result('edit-source').status, 'completed');
        items = [tool('write', { path: 'new/file.txt', expected_sha256: null, content: 'created\n' }, 'write-new')]; break;
      case 5:
        assert.equal(result('write-new').status, 'completed');
        items = [tool('bash', { command: 'test "$(cat source.txt)" = edited && test -f new/file.txt', background: false }, 'verify')]; break;
      default:
        assert.equal(result('verify').exit_code, 0); items = [message('Updated both files and verified them.')];
    }
    const events = items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item }));
    events.push({ type: 'response.completed', response: { status: 'completed', output: [] } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  const bash = new BashRuntime(h.sessions, () => h.work);
  const turns = new Turns(h.sessions, auth, h.models, client, bash, h.files);
  try {
    const input = { ...h.location, revision: 0, requestId: h.turnId, text: 'Edit source and create a new file', accountKey: account.key };
    await turns.start(input);
    const snapshot = await finished(turns, h.location);
    assert.equal(snapshot.status, 'completed'); assert.equal(requests.length, 6);
    assert.equal(readFileSync(join(h.work, 'source.txt'), 'utf8'), 'edited\n');
    assert.equal(readFileSync(join(h.work, 'new/file.txt'), 'utf8'), 'created\n');
    assert.deepEqual(snapshot.activity.steps.filter(step => step.file).map(step => step.file.status), ['completed', 'completed', 'completed', 'completed']);
    assert.equal(snapshot.activity.steps[0].command, 'List .');
    assert.equal(snapshot.activity.steps[0].file.output, 'source.txt');
    assert.ok(!JSON.stringify(h.files.ledger(h.location)).includes('\\"name\\":\\"ls\\"'), 'listings are not mutation-ledger context');
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_REASONING'));
    assert.ok(!JSON.stringify(snapshot).includes('expected_sha256'));
    assert.equal(snapshot.activity.answer, 'Updated both files and verified them.');
    await turns.start(input); assert.equal(requests.length, 6, 'same accepted submission never replays');
    const restarted = new Sessions(new SessionRepository(join(h.root, 'projects'), h.projects), h.models);
    const history = restarted.history(h.location, null);
    assert.equal(history.entries.at(-1).activity.steps.filter(step => step.file).length, 4);
    assert.equal(history.entries.at(-1).activity.steps[0].file.output, 'source.txt');
    assert.ok(restarted.turns(h.location, store => store.context(settings, account.key)).some(item => item.type === 'function_call_output' && item.call_id === 'write-new'));
  } finally { await turns.close(); bash.close(); }
});

test('working-directory prompt keeps spaces and POSIX backslashes, escapes delimiters, and never invents a cwd', () => {
  const path = '/projects/my project\\folder/<cwd>&';
  const prompt = agentInstructions(true, true, path);
  assert.ok(prompt.endsWith('<cwd>\n/projects/my project\\folder/&lt;cwd&gt;&amp;\n</cwd>'));
  assert.ok(!agentInstructions(true, true).includes('\n<cwd>\n'));
  assert.throws(() => agentInstructions(true, true, 'relative/path'), /absolute/);
  assert.throws(() => agentInstructions(true, true, '/path\0invalid'), /absolute/);
});

test('Stop during the next provider request preserves committed file results without repeating the write', opts, async t => {
  const h = fileHarness(t, false), auth = new EventEmitter(); auth.usageSession = () => account;
  let requests = 0, waiting;
  const nextRequest = new Promise(resolve => { waiting = resolve; });
  const client = new CodexInferenceClient(async (_url, options) => {
    if (++requests === 1) return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [tool('write', { path: 'saved', content: 'once', expected_sha256: null }, 'create')] } })}\n\n`);
    waiting();
    return new Promise((_, reject) => { options.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }); });
  });
  const turns = new Turns(h.sessions, auth, h.models, client, undefined, h.files);
  try {
    await turns.start({ ...h.location, revision: 0, requestId: h.turnId, text: 'Create file', accountKey: account.key });
    await nextRequest; turns.stop(h.location, h.turnId);
    const snapshot = await finished(turns, h.location);
    assert.equal(snapshot.status, 'cancelled'); assert.equal(requests, 2);
    assert.equal(snapshot.activity.steps[0].file.status, 'completed');
    assert.equal(readFileSync(join(h.work, 'saved'), 'utf8'), 'once');
  } finally { await turns.close(); }
});
