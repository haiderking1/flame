import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { Sessions } from '../../dist/backend/sessions/service.js';
import { FileTools } from '../../dist/backend/file-tools/service.js';

export const settings = { modelId: 'test-model', effort: null, serviceTier: 'default' };
export const account = { key: 'test', accountId: 'test', access: 'not-a-real-token', epoch: 1 };
export const tool = (name, args, id = randomUUID()) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args) });
export function fileHarness(t, start = true) {
  const root = mkdtempSync(join(tmpdir(), 'flame-file-tools-'));
  const work = join(root, 'work'); mkdirSync(work);
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(work), location = { projectId: project.id, sessionId: randomUUID() };
  const models = { state: { selection: settings, accountKey: account.key }, validateSelection: (_key, value) => value };
  const repository = new SessionRepository(join(root, 'projects'), projects);
  const sessions = new Sessions(repository, models); sessions.create(location);
  const turnId = randomUUID();
  if (start) sessions.turns(location, store => store.start(0, turnId, 'Work on files', settings, account.key));
  const files = new FileTools(sessions, () => work);
  const execute = (name, args, signal = new AbortController().signal, id) => files.execute(location, turnId, tool(name, args, id), signal);
  t.after(() => { projects.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, work, projects, models, repository, sessions, location, turnId, files, execute };
}
