import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planRelease } from '../scripts/desktop/plan.mjs';
import { mergeManifests } from '../scripts/desktop/merge-update-manifests.mjs';

const base = { packageVersion: '0.2.0', today: '20261001', run: '57', tags: ['v0.1.0', 'v0.2.0-nightly.20260930.1', 'v0.2.0-nightly.20261001.1'], head: 'abc', lastNightlyCommit: 'old' };

test('a release run is planned from its trigger: tagged stable, scheduled nightly, or a manual build', () => {
  assert.deepEqual(planRelease({ ...base, event: 'push', ref: 'refs/tags/v0.2.0' }),
    { publish: true, version: '0.2.0', tag: 'v0.2.0', channel: 'latest', prerelease: false, makeLatest: true, updates: true });
  assert.throws(() => planRelease({ ...base, event: 'push', ref: 'refs/tags/v0.3.0' }), /does not match package.json's version 0.2.0/);
  assert.deepEqual(planRelease({ ...base, event: 'schedule' }),
    { publish: true, version: '0.2.0-nightly.20261001.2', tag: 'v0.2.0-nightly.20261001.2', channel: 'nightly', prerelease: true, makeLatest: false, updates: true });
  assert.deepEqual(planRelease({ ...base, event: 'schedule', lastNightlyCommit: 'abc' }), { publish: false, reason: 'Nothing changed since the last nightly.' });
  assert.equal(planRelease({ ...base, event: 'workflow_dispatch', channel: 'nightly', lastNightlyCommit: 'abc' }).version, '0.2.0-nightly.20261001.2', 'a manual nightly always builds');
  assert.deepEqual(planRelease({ ...base, event: 'workflow_dispatch', channel: 'preview' }),
    { publish: true, version: '0.2.0-preview.57', tag: 'v0.2.0-preview.57', channel: 'preview', prerelease: true, makeLatest: false, updates: false });
  assert.equal(planRelease({ ...base, event: 'workflow_dispatch', channel: 'stable' }).version, '0.2.0');
  assert.deepEqual(planRelease({ ...base, tags: [...base.tags, 'v0.2.0'], event: 'workflow_dispatch', channel: 'stable' }).publish, false, 'a released version is not released twice');
});

test('per-architecture update manifests merge into one feed for macOS and Windows', async () => {
  const file = (url) => ({ url, sha512: `${url}-sha`, size: 1 });
  const merged = mergeManifests([{ version: '0.2.0', files: [file('Flame-0.2.0-arm64.dmg'), file('Flame-0.2.0-arm64.zip')], path: 'Flame-0.2.0-arm64.zip', sha512: 'a', releaseDate: '2026-10-01T10:00:00.000Z' },
    { version: '0.2.0', files: [file('Flame-0.2.0-x64.dmg'), file('Flame-0.2.0-x64.zip')], path: 'Flame-0.2.0-x64.zip', sha512: 'b', releaseDate: '2026-10-01T11:00:00.000Z' }]);
  assert.deepEqual(merged.files.map(item => item.url), ['Flame-0.2.0-arm64.dmg', 'Flame-0.2.0-arm64.zip', 'Flame-0.2.0-x64.dmg', 'Flame-0.2.0-x64.zip']);
  assert.deepEqual([merged.path, merged.releaseDate], ['Flame-0.2.0-arm64.zip', '2026-10-01T11:00:00.000Z']);
  assert.throws(() => mergeManifests([{ version: '0.2.0', files: [] }, { version: '0.1.0', files: [] }]), /Cannot merge/);

  const directory = await mkdtemp(join(tmpdir(), 'flame-manifests-'));
  try {
    const manifest = (version, url) => `version: ${version}\nfiles:\n  - url: ${url}\n    sha512: x\n    size: 1\npath: ${url}\nsha512: x\nreleaseDate: '2026-10-01T10:00:00.000Z'\n`;
    await writeFile(join(directory, 'nightly-win-x64.yml'), manifest('0.2.0-nightly.20261001.2', 'Flame-0.2.0-nightly.20261001.2-x64.exe'));
    await writeFile(join(directory, 'nightly-win-arm64.yml'), manifest('0.2.0-nightly.20261001.2', 'Flame-0.2.0-nightly.20261001.2-arm64.exe'));
    await writeFile(join(directory, 'nightly-linux.yml'), manifest('0.2.0-nightly.20261001.2', 'Flame-0.2.0-nightly.20261001.2-x86_64.AppImage'));
    const run = spawnSync(process.execPath, ['scripts/desktop/merge-update-manifests.mjs', directory], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual((await readdir(directory)).sort(), ['nightly-linux.yml', 'nightly.yml']);
    const windows = await readFile(join(directory, 'nightly.yml'), 'utf8');
    assert.ok(windows.includes('-x64.exe') && windows.includes('-arm64.exe'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
