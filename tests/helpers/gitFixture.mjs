import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { GitService } from '../../dist/backend/git/service.js';
import { GitStore } from '../../dist/backend/git/store.js';
import { gitCommand } from '../../dist/backend/git/command.js';

/** A writer that records prompts and answers like the model would. */
export function fakeWriter(reply = {}) {
  const prompts = [];
  return {
    prompts,
    async commit(prompt, _model, includeBranch) { prompts.push(prompt); if (reply.fail) throw Object.assign(new Error(reply.fail), { code: 'COMMAND' }); return { subject: reply.subject ?? 'Generated subject', body: reply.body ?? '', branch: includeBranch ? reply.branch ?? 'feature/generated' : null }; },
    async changeRequest(prompt) { prompts.push(prompt); return { title: reply.title ?? 'Generated title', body: reply.prBody ?? '## Summary\n- change\n\n## Testing\n- Not run' }; },
  };
}
/** A Git service over a temporary project, with helpers to run actions to completion. */
export async function gitFixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flame-git-')), cwd = join(root, 'project'), projectId = randomUUID(); await mkdir(cwd);
  const store = new GitStore(join(root, 'git.sqlite')), changed = [], writer = options.writer ?? fakeWriter();
  const service = new GitService(store, target => { if (target.projectId !== projectId) throw new Error('Unknown project'); return cwd; }, { writer, changed: id => changed.push(id), openPath: options.openPath });
  t.after(async () => { await service.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const input = (action, extra = {}) => ({ projectId, requestId: randomUUID(), action, message: 'Add initial source', filePaths: null, featureBranch: false, expectedBranch: null, model: null, publish: null, ...extra });
  const terminal = async id => { for (let i = 0; i < 1000; i++) { const operation = store.get(id); if (operation?.state !== 'running') return operation; await delay(10); } assert.fail('Git operation never completed'); };
  const run = async (action, extra) => { const request = input(action, extra); await service.start(request); return terminal(request.requestId); };
  const configure = async () => { for (const [key, value] of [['user.name', 'Flame tests'], ['user.email', 'tests@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(cwd, ['config', key, value]); };
  const init = async () => { await gitCommand(cwd, ['init', '--initial-branch=main']); await configure(); };
  /** A bare remote named origin; with `url` the remote reports that URL while Git transparently uses the local copy. */
  const remote = async (url = null) => {
    const bare = join(root, 'remote.git'); await mkdir(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
    await gitCommand(cwd, ['remote', 'add', 'origin', url ?? bare]);
    if (url) await gitCommand(cwd, ['config', `url.${bare}.insteadOf`, url]);
    return bare;
  };
  const head = async (ref = 'HEAD') => (await gitCommand(cwd, ['rev-parse', ref])).stdout.toString().trim();
  const count = async (ref = 'HEAD') => Number((await gitCommand(cwd, ['rev-list', '--count', ref])).stdout.toString().trim());
  return { root, cwd, projectId, store, service, writer, changed, input, terminal, run, init, configure, remote, head, count };
}
