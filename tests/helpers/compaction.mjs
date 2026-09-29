import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { Sessions } from '../../dist/backend/sessions/service.js';
import { Turns } from '../../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../../dist/backend/turns/client.js';
import { BashRuntime } from '../../dist/backend/bash/service.js';
import { FileTools } from '../../dist/backend/file-tools/service.js';

export const settings = { modelId: 'gpt-6.1-sol', effort: 'high', serviceTier: 'default' };
export const account = { key: 'test', accountId: 'test', access: 'test-secret', epoch: 1 };
export const message = text => ({ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text }] });
export const reason = id => ({ type: 'reasoning', id, encrypted_content: `opaque-${id}`, summary: [] });
export const tool = (name, arguments_, id = randomUUID()) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(arguments_) });
export const summary = '## Goal\nComplete the existing user task.\n## Constraints & Preferences\nPreserve approvals.\n## Progress\nDone: earlier work.\n## Key Decisions\nContinue safely.\n## Next Steps\nComplete current request.\n## Critical Context\nDo not replay operations.';
export const isSummary = body => body.instructions.startsWith('Create a context checkpoint');
export const overflow = () => new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'private-provider-details' } }), { status: 400 });
export function completed(output, usage) {
  return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', reasoning: { context: 'all_turns' }, output,
    ...(usage === undefined ? {} : { usage: { input_tokens: usage - 100, output_tokens: 100, total_tokens: usage } }) } })}\n\n`);
}
export async function until(check) {
  for (let i = 0; i < 500; i++) { const value = check(); if (value) return value; await delay(10); }
  assert.fail('Compaction integration did not settle');
}
export function harness(t, respond, contextWindow = 20000) {
  const root = mkdtempSync(join(tmpdir(), 'flame-compaction-agent-')), work = join(root, 'work'); mkdirSync(work);
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(work), location = { projectId: project.id, sessionId: randomUUID() };
  const models = { state: { selection: settings, accountKey: account.key }, validateSelection: (_key, value) => value, contextWindow: () => contextWindow };
  const auth = new EventEmitter(); let currentAccount = account; auth.usageSession = () => currentAccount;
  const requests = [], transportErrors = [];
  const client = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.equal(body.reasoning.context, 'all_turns');
    if (isSummary(body)) { assert.equal(body.tools, undefined); assert.equal(body.reasoning.effort, undefined); }
    let response;
    try { response = await respond(body, options.signal, h); }
    catch (error) { transportErrors.push(error); throw error; }
    return response instanceof Response ? response : completed(response);
  });
  const h = { root, work, projects, location, requests, transportErrors, models, auth };
  const open = () => {
    h.sessions = new Sessions(new SessionRepository(join(root, 'projects'), projects), models);
    h.bash = new BashRuntime(h.sessions, () => work); h.files = new FileTools(h.sessions, () => work);
    h.turns = new Turns(h.sessions, auth, models, client, h.bash, h.files);
  };
  open(); h.sessions.create(location);
  h.seed = (size = 40000, images = []) => {
    const id = randomUUID(), text = `EARLIER_OBJECTIVE\n${'x'.repeat(size)}`;
    h.sessions.turns(location, store => store.start(h.sessions.read(location).revision, id, text, settings, account.key, images));
    h.sessions.turns(location, store => store.finish(id, 'completed', 'Earlier answer', null, [reason(id), message('Earlier answer')]));
  };
  h.start = text => h.turns.start({ ...location, revision: h.sessions.read(location).revision, requestId: randomUUID(), text, accountKey: account.key });
  h.compact = (overrides = {}) => h.turns.compact({ ...location, revision: h.sessions.read(location).revision, requestId: randomUUID(), accountKey: currentAccount.key, ...overrides });
  h.done = () => until(() => { const value = h.turns.snapshot(location); return value && value.status !== 'running' ? value : undefined; });
  h.checkpoints = () => h.sessions.compactions(location, store => store.list());
  h.context = () => h.sessions.turns(location, store => store.context(settings, currentAccount.key));
  h.restart = async () => { await h.turns.close(); h.bash.close(); open(); };
  h.switchAccount = () => { currentAccount = { ...account, key: 'other', epoch: 2 }; auth.emit('change'); };
  t.after(async () => { await h.turns.close(); h.bash.close(); await delay(25); projects.close(); rmSync(root, { recursive: true, force: true }); });
  return h;
}
