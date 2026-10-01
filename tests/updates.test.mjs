import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as machine from '../dist/main/updates/machine.js';
import { ChannelSetting, channelOf } from '../dist/main/updates/channel.js';
import { releaseOf } from '../scripts/desktop/release.mjs';
import { buildConfig } from '../scripts/desktop/config.mjs';

const base = () => machine.initialState({ version: '0.2.0', channel: 'latest', disabledReason: null, translated: false });

test('update states follow the updater: a check, an offer, download progress, a ready update, and failures to retry', () => {
  let state = machine.checking(base());
  assert.equal(state.status, 'checking');
  state = machine.available(state, '0.3.0', 1000);
  assert.deepEqual([state.status, state.availableVersion, state.releaseUrl], ['available', '0.3.0', 'https://github.com/haiderking1/flame/releases/tag/v0.3.0']);
  state = machine.downloading(state, 42.7);
  assert.deepEqual([state.status, state.downloadPercent], ['downloading', 42]);
  assert.equal(machine.checking(state).status, 'downloading', 'a check never interrupts a download');
  state = machine.downloaded(state, '0.3.0');
  assert.deepEqual([state.status, state.downloadedVersion, state.downloadPercent], ['downloaded', '0.3.0', 100]);
  assert.equal(machine.upToDate(state, 2000).status, 'downloaded', 'a ready update stays ready');
  assert.equal(machine.failed(state, 'check', 'x').status, 'downloaded', 'a failed background check keeps it ready');
  assert.equal(machine.available(state, '0.3.0', 2000).status, 'downloaded');
  const switched = machine.switched(state, 'nightly');
  assert.deepEqual([switched.status, switched.channel], ['downloaded', 'nightly']);
  const failed = machine.failed(base(), 'download', machine.updateErrorMessage(new Error('getaddrinfo ENOTFOUND github.com'), 'download'));
  assert.deepEqual([failed.status, failed.errorContext, failed.canRetry, failed.message], ['error', 'download', true, 'Could not download the update. Check your connection and try again.']);
  assert.equal(machine.updateErrorMessage(new Error('HttpError: 404 Cannot find latest-linux.yml https://token@x'), 'check'), 'Could not check for updates. No release was found for this update track.');
  assert.equal(machine.updateErrorMessage(new Error('sha512 checksum mismatch'), 'download'), 'Could not download the update. The download was damaged; try again.');
  const disabled = machine.initialState({ version: '0.2.0', channel: 'latest', disabledReason: 'No feed.', translated: false });
  assert.deepEqual([disabled.enabled, disabled.status, disabled.message], [false, 'disabled', 'No feed.']);
  assert.deepEqual([[null, 3], [3, 9], [9, 10], [10, 19], [19, 100]].map(([a, b]) => machine.progressStep(a, b)), [true, false, true, false, true]);
});

test('the update track comes from the version until the user picks one, and is remembered', async () => {
  assert.equal(channelOf('0.3.0'), 'latest');
  assert.equal(channelOf('0.3.0-nightly.20261001.2'), 'nightly');
  assert.equal(channelOf('0.3.0-beta.1'), 'latest');
  const directory = await mkdtemp(join(tmpdir(), 'flame-update-channel-'));
  try {
    const nightly = new ChannelSetting(directory, '0.3.0-nightly.20261001.2');
    assert.equal(await nightly.load(), 'nightly');
    await nightly.save('latest');
    assert.equal(await new ChannelSetting(directory, '0.3.0-nightly.20261001.2').load(), 'latest');
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'update-settings.json'), 'utf8')), { channel: 'latest' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('releases publish stable and nightly builds to their own update channels, side by side', () => {
  assert.deepEqual(releaseOf('0.3.0'), { version: '0.3.0', channel: 'latest', productName: 'Flame', executable: 'flame' });
  assert.deepEqual(releaseOf('0.3.0-nightly.20261001.2'), { version: '0.3.0-nightly.20261001.2', channel: 'nightly', productName: 'Flame (Nightly)', executable: 'flame-nightly' });
  assert.equal(releaseOf('0.3.0-preview.4').channel, null);
  assert.throws(() => releaseOf('v0.3'), /Invalid version/);
  const stable = buildConfig({ release: releaseOf('0.3.0'), resources: '/r', output: '/o' });
  assert.deepEqual(stable.publish, [{ provider: 'github', owner: 'haiderking1', repo: 'flame', releaseType: 'release', channel: 'latest' }]);
  assert.deepEqual([stable.executableName, stable.extraMetadata.desktopName, stable.linux.desktop.entry.StartupWMClass], ['flame', 'flame.desktop', 'flame']);
  assert.ok(stable.asarUnpack.includes('**/*.node') && stable.asarUnpack.includes('**/*.so'));
  const nightly = buildConfig({ release: releaseOf('0.3.0-nightly.20261001.2'), resources: '/r', output: '/o' });
  assert.deepEqual(nightly.publish[0], { provider: 'github', owner: 'haiderking1', repo: 'flame', releaseType: 'prerelease', channel: 'nightly' });
  assert.deepEqual([nightly.productName, nightly.executableName, nightly.extraMetadata.desktopName], ['Flame (Nightly)', 'flame-nightly', 'flame-nightly.desktop']);
  assert.equal(buildConfig({ release: releaseOf('0.3.0-preview.4'), resources: '/r', output: '/o' }).publish, null, 'previews never publish updates');
});
