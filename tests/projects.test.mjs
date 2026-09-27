import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Schema } from 'effect';
import { Project } from '../dist/contracts/projects.js';
import { browseDirectory, canonicalDirectory, filesystemError } from '../dist/backend/projects/filesystem.js';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { authorizedRequest } from '../dist/backend/server.js';

test('folders are canonicalized, filtered, validated, and persisted idempotently across database reopen', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flame-projects-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'project'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'file.txt'), 'not a directory');
  await symlink(join(root, 'project'), join(root, 'alias'));
  assert.equal(await canonicalDirectory(join(root, 'alias')), join(root, 'project'));
  const listing = await browseDirectory(root);
  assert.deepEqual(listing.entries.map(entry => entry.name), ['alias', 'project']);
  assert.equal(listing.truncated, false);
  await assert.rejects(canonicalDirectory('relative/path'), { code: 'INVALID_PATH' });
  await assert.rejects(canonicalDirectory(`${root}\0`), { code: 'INVALID_PATH' });
  await assert.rejects(canonicalDirectory(join(root, 'file.txt')), { code: 'NOT_DIRECTORY' });
  await assert.rejects(canonicalDirectory(join(root, 'missing')), { code: 'ENOENT' });
  assert.equal(filesystemError({ code: 'EACCES' }).code, 'PERMISSION');
  assert.equal(filesystemError({ code: 'ENOENT' }).code, 'NOT_FOUND');
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(browseDirectory(root, aborted.signal), { name: 'AbortError' });
  const filename = join(root, 'projects.sqlite');
  const store = new ProjectStore(filename);
  let project;
  try {
    project = store.add(await canonicalDirectory(join(root, 'project')));
    assert.deepEqual(store.add(await canonicalDirectory(join(root, 'alias'))), project);
    assert.equal(store.list().length, 1);
  } finally { store.close(); }
  const reopened = new ProjectStore(filename);
  try { assert.deepEqual(reopened.list(), [project]); } finally { reopened.close(); }
  assert.throws(() => Schema.decodeUnknownSync(Project)({ ...project, path: 42 }));
});

test('RPC upgrade authentication requires the configured host, origin, route, and secret', () => {
  const token = randomBytes(32).toString('hex');
  const url = `/rpc?token=${token}`;
  const check = (path = url, host = '127.0.0.1:1234', origin = 'file://') => authorizedRequest(path, host, origin, 1234, token, 'file://');
  assert.equal(check(), true);
  assert.equal(check('/rpc'), false);
  assert.equal(check('/rpc?token=wrong'), false);
  assert.equal(check(`/other?token=${token}`), false);
  assert.equal(check(url, 'attacker.test:1234'), false);
  assert.equal(check(url, '127.0.0.1:1234', 'https://attacker.test'), false);
  assert.equal(authorizedRequest(url, '127.0.0.1:1234', undefined, 1234, token, 'file://'), false);
});
