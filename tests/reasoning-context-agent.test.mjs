import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { BashRuntime } from '../dist/backend/bash/service.js';

const settings = { modelId: 'gpt-6.1-sol', effort: 'high', serviceTier: 'default' };
const account = { key: 'test', accountId: 'test', access: 'test-secret', epoch: 1 };
const reason = id => ({ type: 'reasoning', id, encrypted_content: `opaque-${id}`, summary: [] });
const message = (id, phase, text) => ({ type: 'message', id, role: 'assistant', phase,
  content: [{ type: 'output_text', text, annotations: [] }] });
const tool = command => ({ type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'bash', arguments: JSON.stringify({ command, background: false }) });
function setup(t, respond) {
  const root = mkdtempSync(join(tmpdir(), 'flame-reasoning-context-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(root), location = { projectId: project.id, sessionId: randomUUID() };
  const models = { state: { selection: settings, accountKey: account.key }, validateSelection: (_key, value) => value };
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const requests = [];
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.equal(body.model, 'gpt-6.1-sol');
    assert.equal(body.reasoning.context, 'all_turns');
    const { output, context = 'all_turns' } = respond(body, requests.length);
    const events = output.map((item, output_index) => ({ type: 'response.output_item.done', item, output_index }));
    events.push({ type: 'response.completed', response: { status: 'completed', reasoning: { context }, output: [] } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  const h = { root, projects, location, requests };
  const open = () => {
    h.sessions = new Sessions(new SessionRepository(join(root, 'projects'), projects), models);
    h.bash = new BashRuntime(h.sessions, () => root);
    h.turns = new Turns(h.sessions, auth, models, client, h.bash);
  };
  open(); h.sessions.create(location);
  h.start = text => h.turns.start({ ...location, revision: h.sessions.read(location).revision, requestId: randomUUID(), text, accountKey: account.key });
  h.restart = async () => { await h.turns.close(); h.bash.close(); open(); };
  t.after(async () => { await h.turns.close(); h.bash.close(); projects.close(); rmSync(root, { recursive: true, force: true }); });
  return h;
}
async function finished(h) {
  for (let i = 0; i < 400; i++) {
    const turn = h.turns.snapshot(h.location);
    if (turn && turn.status !== 'running') return turn;
    await delay(10);
  }
  assert.fail('Turn did not finish');
}

test('GPT-6.1 Sol reasoning and phases survive a tool call, restart and a follow-up at another effort',
  { timeout: 10000, skip: process.platform === 'win32' }, async t => {
    const first = [reason('rs_tool'), message('msg_commentary', 'commentary', 'Checking.'), tool('printf checked')];
    const second = [reason('rs_answer'), message('msg_final', 'final_answer', 'Checked.')];
    const h = setup(t, (body, n) => {
      if (n === 1) return { output: first };
      assert.ok(body.input.some(item => item.encrypted_content === 'opaque-rs_tool'));
      assert.ok(body.input.some(item => item.id === 'msg_commentary' && item.phase === 'commentary'));
      assert.ok(body.input.some(item => item.type === 'function_call_output' && JSON.parse(item.output).output === 'checked'));
      if (n === 2) return { output: second };
      assert.equal(n, 3);
      assert.equal(body.reasoning.effort, 'low');
      assert.ok(body.input.some(item => item.encrypted_content === 'opaque-rs_answer'));
      assert.ok(body.input.some(item => item.id === 'msg_final' && item.phase === 'final_answer'));
      assert.equal(body.input.at(-1).content[0].text, 'Continue');
      return { output: [reason('rs_followup'), message('msg_followup', 'final_answer', 'Continued.')] };
    });
    await h.start('Check');
    const done = await finished(h);
    assert.equal(done.status, 'completed');
    assert.ok(!JSON.stringify(done).includes('opaque-'));
    assert.equal(h.requests.length, 2);
    await h.restart();
    h.sessions.configure(h.location, h.sessions.read(h.location).revision, account.key, { ...settings, effort: 'low' });
    await h.start('Continue');
    assert.equal((await finished(h)).status, 'completed');
    assert.equal(h.requests.length, 3);
  });

test('a context downgrade marks the turn failed, surfaces the error and prevents tool execution',
  { timeout: 10000, skip: process.platform === 'win32' }, async t => {
    const h = setup(t, () => ({ context: 'current_turn', output: [reason('rs_bad'), tool('printf x > marker')] }));
    await h.start('Check');
    const done = await finished(h);
    assert.equal(done.status, 'failed');
    assert.match(done.message, /reasoning across turns/);
    assert.equal(h.requests.length, 1);
    assert.equal(existsSync(join(h.root, 'marker')), false);
    assert.equal(h.bash.list(h.location).length, 0);
    assert.ok(!JSON.stringify(h.sessions.turns(h.location, store => store.context(settings, account.key))).includes('opaque-rs_bad'));
  });
