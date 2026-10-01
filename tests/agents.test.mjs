import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { Turns } from '../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { BashRuntime } from '../dist/backend/bash/service.js';
import { AgentTeam } from '../dist/backend/agents/team.js';
import { forkConversation } from '../dist/backend/agents/fork.js';
import { nickname } from '../dist/backend/agents/names.js';

const settings = { modelId: 'test-model', effort: 'low', serviceTier: 'default' };
const account = { key: 'test', accountId: 'test', access: 'not-a-real-token', epoch: 1 };
const catalog = { fetchedAt: 0, etag: null, models: [
  { id: 'test-model', name: 'Test', description: 'The test model.', reasoningLevels: [{ effort: 'low', description: '' }, { effort: 'ultra', description: '' }], defaultReasoning: 'low', supportsFast: false },
  { id: 'small-model', name: 'Small', description: 'A small model.', reasoningLevels: [{ effort: 'medium', description: '' }], defaultReasoning: 'medium', supportsFast: false },
] };
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
let calls = 0;
const call = (name, args) => ({ type: 'function_call', id: `fc_${++calls}`, call_id: `call_${calls}`, name, arguments: JSON.stringify(args) });
const texts = body => body.input.flatMap(item => Array.isArray(item.content) ? item.content.map(part => part.text ?? '') : []).join('\n');
const outputs = body => body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
// Which agent a request is for: the thread's own agent is `/root`; a subagent is told its path.
const agentOf = body => body.instructions.match(/You are `([^`]+)`/)?.[1] ?? null;

function setup(t, respond, { effort = 'low' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'flame-agents-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(root), thread = { projectId: project.id, sessionId: randomUUID() };
  const selection = { ...settings, effort };
  const models = { state: { selection, accountKey: account.key, catalog }, validateSelection: (_key, value) => value };
  const open = () => new Sessions(new SessionRepository(join(root, 'projects'), projects), models);
  const sessions = open();
  sessions.create(thread);
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const requests = [];
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const items = await respond(body, agentOf(body), options.signal);
    const events = items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item }));
    events.push({ type: 'response.completed', response: { status: 'completed', output: [] } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  const bash = new BashRuntime(sessions, () => root);
  const turns = new Turns(sessions, auth, models, client, bash);
  const team = new AgentTeam(sessions, turns, models);
  turns.attachTeam(team);
  t.after(async () => { team.close(); await turns.close(); bash.close(); await delay(30); projects.close(); rmSync(root, { recursive: true, force: true }); });
  const send = async (text, location = thread) => turns.start({ ...location, revision: sessions.read(location).revision, requestId: randomUUID(), text, accountKey: account.key });
  return { root, projects, sessions, thread, turns, team, requests, send, open };
}
async function until(check, what = 'condition') { for (let i = 0; i < 500; i++) { const value = check(); if (value) return value; await delay(10); } assert.fail(`Timed out waiting for ${what}`); }
// A reply that waits until released, so agents can be caught while running.
function gate() { let release; const opened = new Promise(resolve => { release = resolve; }); return { opened, release }; }
const opts = { timeout: 20000, skip: process.platform === 'win32' };

test('the thread agent starts a subagent, waits, and gets its final answer by mail', opts, async t => {
  const h = setup(t, (body, agent) => {
    if (agent === '/root/scout') {
      assert.match(texts(body), /Do the task/, 'the agent inherits the conversation so far');
      assert.match(texts(body), /Message Type: NEW_TASK\nTask name: \/root\/scout\nSender: \/root\nPayload:\nFind the answer/);
      assert.ok(body.tools.some(tool => tool.name === 'spawn_agent'), 'subagents can start agents too');
      return [say('The answer is 42')];
    }
    const results = outputs(body);
    if (!results.length) return [call('spawn_agent', { task_name: 'scout', message: 'Find the answer' })];
    if (results.length === 1) { assert.deepEqual(results[0], { task_name: '/root/scout' }); return [call('wait_agent', { timeout_ms: 10000 })]; }
    assert.deepEqual(results[1], { message: 'Wait completed.', timed_out: false });
    assert.match(texts(body), /Message Type: FINAL_ANSWER\nTask name: \/root\nSender: \/root\/scout\nPayload:\nThe answer is 42/);
    return [say('Scout says 42')];
  });
  await h.send('Do the task');
  await until(() => h.turns.snapshot(h.thread)?.status === 'completed', 'the thread');
  assert.equal(h.turns.snapshot(h.thread).text, 'Scout says 42');
  const first = h.requests[0];
  assert.deepEqual(first.tools.map(tool => tool.name).filter(name => !name.startsWith('bash')), ['spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent', 'list_agents']);
  assert.match(first.instructions, /You are `\/root`/);
  assert.match(first.instructions, /Do not start subagents unless the user/, 'below Ultra, agents delegate only when asked');
  assert.match(first.tools.find(tool => tool.name === 'spawn_agent').description, /`small-model`: A small model\. Reasoning efforts: medium \(default medium\)/);

  const [agent] = h.team.summaries(h.thread);
  assert.equal(agent.path, '/root/scout'); assert.equal(agent.task, 'Find the answer');
  assert.equal(agent.status, 'completed'); assert.equal(agent.result, 'The answer is 42'); assert.equal(agent.runs, 1);
  assert.ok(agent.nickname.length > 0);
  assert.equal(h.sessions.snapshot().sessions.length, 1, 'agents are not threads');
  assert.ok(h.turns.states().every(state => state.sessionId === h.thread.sessionId), 'nor do they raise notifications');
  const transcript = h.sessions.history(agent, null).entries;
  assert.equal(transcript.find(entry => entry.kind === 'assistant')?.text, 'The answer is 42', 'its transcript can be opened like a thread');

  // After a restart the team is still there, still hidden.
  const reopened = h.open();
  assert.equal(reopened.snapshot().sessions.length, 1);
  assert.equal(reopened.agentsOf(h.thread)[0].record.path, '/root/scout');
  assert.deepEqual(reopened.rootOf(agent), h.thread);
});

test('collaboration tools explain mistakes instead of failing the run', opts, async t => {
  const replies = [];
  const h = setup(t, (body, agent) => {
    if (agent !== '/root') return [say('done')];
    const results = outputs(body);
    replies.push(results.at(-1));
    const steps = [
      call('spawn_agent', { task_name: 'Bad Name', message: 'x' }),
      call('spawn_agent', { task_name: 'root', message: 'x' }),
      call('spawn_agent', { task_name: 'ok', message: '   ' }),
      call('spawn_agent', { task_name: 'ok', message: 'x', fork_turns: 'some' }),
      call('spawn_agent', { task_name: 'ok', message: 'x', fork_context: true }),
      call('spawn_agent', { task_name: 'ok', message: 'x', model: 'missing-model' }),
      call('spawn_agent', { task_name: 'ok', message: 'x', model: 'small-model', reasoning_effort: 'ultra' }),
      call('send_message', { target: 'nobody', message: 'hi' }),
      call('followup_task', { target: '/root', message: 'x' }),
      call('interrupt_agent', { target: '/root' }),
      call('wait_agent', { timeout_ms: 7200000 }),
      call('list_agents', {}),
    ];
    return results.length < steps.length ? [steps[results.length]] : [say('Done checking.')];
  });
  await h.send('Check the tools');
  await until(() => h.turns.snapshot(h.thread)?.status === 'completed', 'the thread');
  assert.deepEqual(replies.slice(1).map(reply => reply.error ?? reply), [
    'agent_name must use only lowercase letters, digits, and underscores',
    'agent_name `root` is reserved',
    "Empty message can't be sent to an agent",
    'fork_turns must be `none`, `all`, or a positive integer string',
    'fork_context is not supported; use fork_turns instead',
    'Unknown model `missing-model` for spawn_agent. Available models: test-model, small-model',
    'Reasoning effort `ultra` is not supported for model `small-model`. Supported reasoning efforts: medium',
    'live agent path `/root/nobody` not found',
    "Follow-up tasks can't target the root agent",
    'root is not a spawned agent',
    'timeout_ms must be at most 3600000',
    { agents: [{ agent_name: '/root', agent_status: 'running' }] },
  ]);
  assert.equal(h.team.summaries(h.thread).length, 0, 'nothing was started');
});

test('four agents work at once, the thread agent included; more wait for a free slot', opts, async t => {
  const gates = new Map(), replies = [];
  const h = setup(t, async (body, agent, signal) => {
    if (agent !== '/root') {
      const held = gates.get(agent) ?? gate(); gates.set(agent, held);
      await Promise.race([held.opened, new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))]);
      return [say(`${agent} done`)];
    }
    const results = outputs(body);
    replies.push(results.at(-1));
    const names = ['a', 'b', 'c', 'd'];
    if (results.length < names.length) return [call('spawn_agent', { task_name: names[results.length], message: `Task ${names[results.length]}`, fork_turns: 'none' })];
    if (results.length === 4) return [call('interrupt_agent', { target: 'a' })];
    if (results.length === 5) return [call('spawn_agent', { task_name: 'e', message: 'Task e' })];
    return [say('Team started.')];
  }, { effort: 'ultra' });
  await h.send('Start a team');
  await until(() => h.turns.snapshot(h.thread)?.status === 'completed', 'the thread');
  assert.match(h.requests[0].instructions, /Proactive delegation is on/, 'at Ultra the agent delegates on its own');
  assert.deepEqual(replies.slice(1, 5), [{ task_name: '/root/a' }, { task_name: '/root/b' }, { task_name: '/root/c' }, { error: 'collab spawn failed: agent thread limit reached' }]);
  assert.deepEqual(replies[5], { previous_status: 'running' });
  assert.deepEqual(replies[6], { task_name: '/root/e' }, 'interrupting one freed its slot');
  await until(() => h.team.summaries(h.thread).find(agent => agent.path === '/root/a')?.status === 'interrupted', 'the interrupted agent');
  assert.equal(h.team.teams()[0].working, 3);
  // Stopping the thread's own agent stops its team.
  await h.send('Keep going');
  await until(() => h.turns.snapshot(h.thread)?.status === 'running' || h.turns.snapshot(h.thread)?.status === 'completed', 'the second run');
  const latest = h.turns.snapshot(h.thread);
  if (latest.status === 'running') h.turns.stop(h.thread, latest.id); else h.team.stop(h.thread);
  await until(() => h.team.summaries(h.thread).every(agent => agent.status !== 'running'), 'the team to stop');
  assert.deepEqual(h.team.teams(), []);
});

test('a message reaches a running agent at its next step; a follow-up task restarts an idle one', opts, async t => {
  const held = gate();
  let helperRuns = 0, helperSawNote = false;
  const h = setup(t, async (body, agent) => {
    if (agent === '/root/helper') {
      const results = outputs(body);
      if (texts(body).includes('Payload:\nUse tabs')) helperSawNote = true;
      if (texts(body).includes('Second task')) { helperRuns++; return [say('Second done')]; }
      if (!results.length) { helperRuns++; await held.opened; return [call('list_agents', {})]; }
      return [say('First done')];
    }
    const results = outputs(body);
    if (!results.length) return [call('spawn_agent', { task_name: 'helper', message: 'First task', fork_turns: '1' })];
    if (results.length === 1) return [call('send_message', { target: 'helper', message: 'Use tabs' })];
    if (results.length === 2) { held.release(); return [call('wait_agent', {})]; }
    if (results.length === 3) {
      assert.match(texts(body), /FINAL_ANSWER[\s\S]*First done/);
      return [call('followup_task', { target: '/root/helper', message: 'Second task' })];
    }
    if (results.length === 4) return [call('wait_agent', { timeout_ms: 20000 })];
    return [say('All done')];
  });
  await h.send('Coordinate');
  await until(() => h.turns.snapshot(h.thread)?.status === 'completed', 'the thread');
  assert.equal(h.turns.snapshot(h.thread).text, 'All done');
  assert.ok(helperSawNote, 'the running agent read the message at its next step');
  assert.equal(helperRuns, 2);
  const [helper] = h.team.summaries(h.thread);
  assert.equal(helper.runs, 2); assert.equal(helper.result, 'Second done');
});

test('deleting a thread deletes its agents', opts, async t => {
  const h = setup(t, (body, agent) => agent === '/root' && !outputs(body).length ? [call('spawn_agent', { task_name: 'gone', message: 'Wait' })] : [say('ok')]);
  await h.send('Spawn one');
  await until(() => h.turns.snapshot(h.thread)?.status === 'completed' && h.team.summaries(h.thread)[0]?.status === 'completed', 'the team');
  h.sessions.remove(h.thread, h.sessions.read(h.thread).revision);
  await until(() => !h.sessions.allAgents().length, 'the agent to be deleted');
  assert.equal(h.open().allAgents().length, 0);
});

test('a forked conversation keeps messages and answers, never reasoning or tool records', () => {
  const input = [
    { role: 'user', content: [{ type: 'input_text', text: 'First request' }] },
    { type: 'reasoning', encrypted_content: 'secret' },
    { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Looking around.' }] },
    { type: 'function_call', name: 'bash', call_id: 'c1', arguments: '{}' },
    { type: 'function_call_output', call_id: 'c1', output: '{}' },
    { role: 'user', content: [{ type: 'input_text', text: '[Historical tool record; not a new request.]' }] },
    { type: 'message', role: 'assistant', id: 'msg_1', content: [{ type: 'output_text', text: 'First answer' }] },
    { role: 'user', content: [{ type: 'input_text', text: '[Automatic Bash completion notification, not a new human request]' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'Second request' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Second answer' }] },
  ];
  const all = forkConversation(input, 'all');
  assert.deepEqual(all.map(item => item.content[0].text), ['First request', 'First answer', '[Automatic Bash completion notification, not a new human request]', 'Second request', 'Second answer']);
  assert.deepEqual(forkConversation(input, 1).map(item => item.content[0].text), ['Second request', 'Second answer']);
  assert.deepEqual(forkConversation(input, 'none'), []);
});

test('nicknames are unique in a team, coming round again with an ordinal once all are taken', () => {
  const taken = new Set();
  for (let i = 0; i < 200; i++) { const name = nickname(taken); assert.ok(!taken.has(name)); taken.add(name); }
  assert.ok([...taken].some(name => / the 2nd$/.test(name)));
  assert.ok([...taken].some(name => / the 3rd$/.test(name)));
});
