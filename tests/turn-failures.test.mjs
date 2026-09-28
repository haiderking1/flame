import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { Turns } from '../dist/backend/turns/service.js';

const settings = { modelId: 'fixture', effort: null, serviceTier: 'default' };
function setup(t, client) {
  const root = mkdtempSync(join(tmpdir(), 'flame-turn-failures-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const projectId = projects.add(join(root, 'workspace')).id;
  const location = { projectId, sessionId: randomUUID() };
  const repository = new SessionRepository(join(root, 'projects'), projects);
  const models = { state: { selection: settings, accountKey: 'account' }, validateSelection: (key, selection) => selection };
  const sessions = new Sessions(repository, models); sessions.create(location);
  const auth = new EventEmitter(); auth.usageSession = () => ({ key: 'account', accountId: 'fixture', access: 'secret', epoch: 1 });
  const turns = new Turns(sessions, auth, models, client);
  const raw = new DatabaseSync(join(root, 'projects', projectId, 'sessions', location.sessionId, 'session.sqlite'));
  t.after(async () => { await turns.close(); raw.close(); projects.close(); rmSync(root, { recursive: true, force: true }); });
  const input = { ...location, revision: 0, requestId: randomUUID(), text: 'Hello', accountKey: 'account' };
  return { location, models, sessions, auth, turns, raw, input };
}
async function finished(h) {
  for (let i = 0; i < 200; i++) { const state = h.turns.snapshot(h.location); if (state?.status !== 'running') return state; await delay(10); }
  assert.fail('Response did not terminate');
}

test('a failed durable turn claim cannot send a provider request or append a partial user message', async (t) => {
  let calls = 0;
  const h = setup(t, { run: async () => { calls++; throw new Error('must not run'); } });
  h.raw.exec("CREATE TRIGGER fail_turn BEFORE INSERT ON turns BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await assert.rejects(h.turns.start(h.input));
  assert.equal(calls, 0); assert.equal(h.sessions.read(h.location).revision, 0);
  assert.equal(h.sessions.history(h.location, null).entries.length, 0);
});

test('failed response persistence preserves the checkpoint, blocks replay, and recovers after storage is repaired', async (t) => {
  let calls = 0;
  const h = setup(t, { run: async (request, onText) => {
    calls++; onText('Durable paragraph.\n\n'); await delay(460);
    return { text: 'Durable paragraph.\n\nFinal answer.', output: [] };
  } });
  h.raw.exec("CREATE TRIGGER fail_answer BEFORE INSERT ON entries WHEN NEW.kind='assistant' BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await h.turns.start(h.input);
  const state = await finished(h);
  assert.equal(state.status, 'interrupted'); assert.equal(state.revision, -1);
  assert.match(state.message, /could not be saved/);
  assert.equal(h.sessions.turns(h.location, (store) => store.snapshot()).status, 'running');
  await h.turns.start(h.input); assert.equal(calls, 1);
  assert.equal(h.sessions.history(h.location, null).entries.length, 1, 'failed assistant insert rolled back');
  await h.turns.close(); h.raw.exec('DROP TRIGGER fail_answer');
  const restarted = new Turns(h.sessions, h.auth, h.models, { run: async () => { calls++; throw new Error('no replay'); } });
  assert.equal(restarted.snapshot(h.location).text, 'Durable paragraph.\n\n');
  assert.equal(restarted.snapshot(h.location).status, 'interrupted');
  await restarted.start(h.input); assert.equal(calls, 1); await restarted.close();
});

test('network failure preserves partial output and never persists secret exceptions or retries the request', async (t) => {
  let calls = 0;
  const h = setup(t, { run: async (request, onText) => { calls++; onText('Partial answer'); throw new Error('secret-token-and-server-body'); } });
  await h.turns.start(h.input);
  const state = await finished(h);
  assert.equal(state.status, 'failed'); assert.equal(state.text, 'Partial answer');
  assert.ok(!JSON.stringify(state).includes('secret'));
  await h.turns.start(h.input); assert.equal(calls, 1);
  assert.equal(h.sessions.history(h.location, null).entries.at(-1).text, 'Partial answer');
});
