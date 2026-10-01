import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { Sessions } from '../../dist/backend/sessions/service.js';
import { Turns } from '../../dist/backend/turns/service.js';
import { CodexInferenceClient } from '../../dist/backend/turns/client.js';
import { BashRuntime } from '../../dist/backend/bash/service.js';
import { gitCommand } from '../../dist/backend/git/command.js';
import { WorkspaceRoots } from '../../dist/backend/worktrees/roots.js';
import { WorktreeStore } from '../../dist/backend/worktrees/store.js';
import { Worktrees } from '../../dist/backend/worktrees/service.js';

export const settings = { modelId: 'test-model', effort: null, serviceTier: 'default' };
export const account = { key: 'test', accountId: 'test', access: 'not-a-real-token', epoch: 1 };
export const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
export const bashCall = (command, id = 'call_test') => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name: 'bash', arguments: JSON.stringify({ command, background: false }) });
export async function until(check, what = 'condition') { for (let i = 0; i < 1000; i++) { const value = await check(); if (value) return value; await delay(10); } assert.fail(`Timed out waiting for ${what}`); }
export const git = async (cwd, args) => (await gitCommand(cwd, args)).stdout.toString('utf8').trim();

/**
 * A Git project with one commit, sessions, Bash, worktrees and turns over a fake model. `respond(body, n)` returns the
 * model's output items; `namer` stands in for the Git text model that names worktree branches.
 */
export async function worktreeFixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flame-worktrees-')));
  const project = join(root, 'project'); mkdirSync(project);
  await gitCommand(project, ['init', '--initial-branch=main']);
  for (const [key, value] of [['user.name', 'Flame tests'], ['user.email', 'tests@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(project, ['config', key, value]);
  writeFileSync(join(project, 'README.md'), '# Project\n'); writeFileSync(join(project, '.gitignore'), 'node_modules/\n.env\n');
  await gitCommand(project, ['add', '.']); await gitCommand(project, ['commit', '-m', 'Initial commit']);
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const added = projects.add(project);
  const models = { state: { selection: settings, accountKey: account.key }, validateSelection: (_key, value) => value };
  const sessions = new Sessions(new SessionRepository(join(root, 'projects'), projects), models);
  const roots = new WorkspaceRoots(projects, sessions);
  const changed = [];
  const store = new WorktreeStore(join(root, 'flame.sqlite'));
  const bash = new BashRuntime(sessions, location => roots.session(location));
  let turns;
  const busy = path => sessions.snapshot().sessions.some(session => (session.workspace.worktreePath ?? roots.project(session.projectId)) === path && turns?.isRunning(session));
  const named = [];
  const namer = options.namer ?? { async branch(prompt, images) { named.push({ prompt, images }); return options.branchName ?? 'Fix login redirect'; } };
  const worktrees = new Worktrees({ sessions, projects, roots, store, directory: join(root, 'worktrees'), namer, changed: path => changed.push(path), busy });
  const auth = new EventEmitter(); auth.usageSession = () => account;
  const requests = [];
  const client = new CodexInferenceClient(async (_url, request) => {
    const body = JSON.parse(request.body); requests.push(body);
    const items = await (options.respond ?? (() => [message('Done.')]))(body, requests.length, request.signal);
    const events = items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item }));
    events.push({ type: 'response.completed', response: { status: 'completed', output: [] } });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  turns = new Turns(sessions, auth, models, client, bash, undefined, worktrees);
  t.after(async () => { await turns.close(); await worktrees.close(); bash.close(); await delay(30); store.close(); projects.close(); rmSync(root, { recursive: true, force: true }); });
  const create = () => { const location = { projectId: added.id, sessionId: randomUUID() }; sessions.create(location); return location; };
  const workspace = location => sessions.read(location).workspace;
  const configure = (location, next) => worktrees.configure(location, sessions.read(location).revision, next);
  const newWorktree = (location, extra = {}) => configure(location, { mode: 'worktree', baseBranch: 'main', startFromOrigin: false, branch: null, worktreePath: null, ...extra });
  const send = async (location, text = 'Fix the login redirect', images) => {
    const input = { ...location, revision: sessions.read(location).revision, requestId: randomUUID(), text, accountKey: account.key, ...(images ? { images } : {}) };
    await turns.start(input);
    return input.requestId;
  };
  const settle = async location => until(() => { const turn = turns.snapshot(location); return turn && turn.status !== 'running' && turn; }, 'the response to finish');
  return { root, project, projectId: added.id, projects, sessions, roots, store, bash, worktrees, get turns() { return turns; }, requests, changed, named,
    create, workspace, configure, newWorktree, send, settle };
}
