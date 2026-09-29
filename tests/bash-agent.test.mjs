import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { BashRuntime } from '../dist/backend/bash/service.js';
const settings = { modelId: 'test-model', effort: null, serviceTier: 'default' };
const account = { key: 'test', accountId: 'test', access: 'not-a-real-token', epoch: 1 };
const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (command, background = false) => ({ type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'bash', arguments: JSON.stringify({ command, background }) });
function setup(t, respond) {
  const root = mkdtempSync(join(tmpdir(), 'flame-bash-agent-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(root), location = { projectId: project.id, sessionId: randomUUID() };
  const models = { state: { selection: settings, accountKey: account.key }, validateSelection: (_key, value) => value };
  const sessions = new Sessions(new SessionRepository(join(root, 'projects'), projects), models);
  sessions.create(location);
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const requests = [];
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.ok(body.tools.some(tool => tool.name === 'bash'));
    assert.ok(body.instructions.endsWith(`<cwd>\n${root}\n</cwd>`), 'every request, including background continuations, uses this project directory');
    const items = await respond(body, requests.length, options.signal);
    const events = items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item }));
    events.push({ type: 'response.completed', response: { status: 'completed', output: [] } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  const bash = new BashRuntime(sessions, id => { assert.equal(id, project.id); return root; });
  const turns = new Turns(sessions, auth, models, client, bash);
  t.after(async () => { await turns.close(); bash.close(); await delay(30); projects.close(); rmSync(root, { recursive: true, force: true }); });
  const input = { ...location, revision: sessions.read(location).revision, requestId: randomUUID(), text: 'Do the task', accountKey: account.key };
  return { root, projects, sessions, location, bash, turns, requests, input };
}
async function until(check) { for (let i = 0; i < 400; i++) { const value = check(); if (value) return value; await delay(10); } assert.fail('Integration did not settle'); }
const opts = { timeout: 10000, skip: process.platform === 'win32' };

test('actual Responses parser executes Bash once, sends the result back, and persists full tool context', opts, async t => {
  const h = setup(t, (body, n) => {
    if (n === 1) return [call('printf x >> marker; printf "real output"; exit 7')];
    const result = JSON.parse(body.input.find(item => item.type === 'function_call_output').output);
    assert.equal(result.exit_code, 7); assert.equal(result.output, 'real output');
    return [message('Command failed with exit 7. I did not replay it.')];
  });
  await h.turns.start(h.input);
  await until(() => h.turns.snapshot(h.location)?.status === 'completed');
  assert.equal(readFileSync(join(h.root, 'marker'), 'utf8'), 'x');
  assert.equal(h.requests.length, 2);
  await h.turns.start(h.input); await delay(20);
  assert.equal(h.requests.length, 2);
  const context = h.sessions.turns(h.location, store => store.context(settings, account.key));
  assert.ok(context.some(item => item.type === 'function_call_output'));
  assert.equal(h.bash.list(h.location)[0].exitCode, 7);
  assert.equal(h.sessions.jobs(h.location, store => store.list()).length, 1);
});

test('background completion wakes an idle model once without polling or inventing a user message', opts, async t => {
  const h = setup(t, (_body, n) => n === 1 ? [call('sleep 0.2; printf x >> marker; printf finished', true)] : [message(n === 2 ? 'Background job started.' : 'Background job finished.')]);
  await h.turns.start(h.input);
  await until(() => h.requests.length === 3 && h.turns.snapshot(h.location)?.status === 'completed');
  assert.equal(readFileSync(join(h.root, 'marker'), 'utf8'), 'x');
  assert.ok(JSON.stringify(h.requests[2].input).includes('Automatic Bash completion notification'));
  assert.equal(h.sessions.history(h.location, null).entries.filter(entry => entry.kind === 'user').length, 1);
  await delay(100); assert.equal(h.requests.length, 3);
  assert.equal(h.bash.pending(h.location, account.key).length, 0);
});

test('Stop cancels real Bash and the agent loop without a follow-up provider request', opts, async t => {
  const h = setup(t, () => [call('printf started; sleep 60')]);
  await h.turns.start(h.input);
  await until(() => h.bash.list(h.location)[0]?.text.includes('started'));
  h.turns.stop(h.location, h.input.requestId);
  await until(() => h.turns.snapshot(h.location)?.status === 'cancelled');
  await until(() => h.bash.list(h.location)[0]?.status === 'cancelled');
  assert.equal(h.requests.length, 1);
});

test('a failed durable Bash claim prevents shell execution', opts, async t => {
  const h = setup(t, (_body, n) => n === 1 ? [call('printf x > marker')] : [message('Execution was not confirmed.')]);
  const original = h.sessions.jobs.bind(h.sessions);
  h.sessions.jobs = (location, work) => original(location, store => work(new Proxy(store, { get(target, property) {
    if (property === 'save') return () => { throw new Error('Disk unavailable'); };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  await h.turns.start(h.input);
  await until(() => h.turns.snapshot(h.location)?.status === 'completed');
  assert.throws(() => readFileSync(join(h.root, 'marker')), /ENOENT/);
  h.sessions.jobs = original;
});

test('the launch gate prevents side effects when process identity cannot be saved', opts, async t => {
  const h = setup(t, (_body, n) => n === 1 ? [call('printf x > marker')] : [message('Launch was not confirmed.')]);
  const original = h.sessions.jobs.bind(h.sessions);
  h.sessions.jobs = (location, work) => original(location, store => work(new Proxy(store, { get(target, property) {
    if (property === 'save') return job => { if (job.status === 'running') throw new Error('Identity write failed'); return target.save(job); };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  await h.turns.start(h.input);
  await until(() => ['completed', 'cancelled', 'failed'].includes(h.turns.snapshot(h.location)?.status));
  assert.throws(() => readFileSync(join(h.root, 'marker')), /ENOENT/);
  assert.notEqual(h.bash.list(h.location)[0].status, 'running');
  h.sessions.jobs = original;
});

test('interrupted launch claims recover as uncertain without spawning or blindly signalling a PID', opts, async t => {
  const h = setup(t, () => [message('Done.')]);
  await h.turns.start(h.input);
  await until(() => h.turns.snapshot(h.location)?.status === 'completed');
  await h.turns.close();
  const job = { id: randomUUID(), turnId: h.input.requestId, callId: 'interrupted-call', command: 'printf x > marker', background: true,
    accountKey: account.key, pid: process.pid, identity: 'not-this-process-identity', notified: false,
    status: 'running', exitCode: null, signal: null, text: 'checkpoint', truncated: false, outputClosed: false, message: null, createdAt: Date.now() };
  h.sessions.jobs(h.location, store => store.save(job));
  const recovered = new BashRuntime(h.sessions, () => h.root);
  try {
    const saved = recovered.get(h.location, job.id);
    assert.equal(saved.status, 'interrupted'); assert.equal(saved.text, 'checkpoint');
    assert.match(saved.message, /could not be verified/);
    assert.throws(() => readFileSync(join(h.root, 'marker')), /ENOENT/);
    assert.equal(recovered.pending(h.location, account.key).length, 1);
    recovered.acknowledge(h.location, [job.id]);
    assert.equal(recovered.pending(h.location, account.key).length, 0);
  } finally { recovered.close(); }
});

test('composer Stop suppresses background follow-ups as well as cancelling the provider request', opts, async t => {
  const h = setup(t, (_body, n, signal) => n === 1 ? [call('printf started; sleep 60', true)] : new Promise((_, reject) => {
    const abort = () => reject(new Error('aborted'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  }));
  await h.turns.start(h.input);
  await until(() => h.requests.length === 2 && h.bash.list(h.location)[0]?.text.includes('started'));
  h.turns.stop(h.location, h.input.requestId);
  await until(() => h.turns.snapshot(h.location)?.status === 'cancelled');
  await until(() => h.bash.list(h.location)[0]?.status === 'cancelled');
  await delay(100);
  assert.equal(h.requests.length, 2); assert.equal(h.bash.pending(h.location, account.key).length, 0);
});
