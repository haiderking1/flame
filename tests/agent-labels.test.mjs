import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('./helpers/contracts-alias.mjs', import.meta.url);
const labels = await import('../src/renderer/components/agents/agentLabels.ts');

test('agent statuses read as T3 Code labels them', () => {
  assert.deepEqual(['pending', 'running', 'completed', 'errored', 'interrupted'].map(labels.statusLabel), ['Working', 'Working', 'Idle · resumable', 'Failed', 'Stopped']);
  assert.deepEqual(['pending', 'running', 'completed', 'errored', 'interrupted'].map(labels.toneOf), ['working', 'working', 'idle', 'failed', 'stopped']);
});

test('tokens, elapsed time and model read compactly', () => {
  assert.deepEqual([null, 950, 1234, 12_345, 1_234_567, 2_000_000].map(labels.formatTokens), ['— tok', '950 tok', '1.2k tok', '12k tok', '1.2M tok', '2M tok']);
  assert.deepEqual([0, 42_000, 185_000, 3_725_000].map(labels.formatElapsed), ['0s', '42s', '3m 05s', '1h 02m']);
  assert.equal(labels.modelLabel({ settings: { modelId: 'gpt-x', effort: 'high', serviceTier: 'default' } }), 'gpt-x · high');
  assert.equal(labels.modelLabel({ settings: { modelId: 'gpt-x', effort: null, serviceTier: 'default' } }), 'gpt-x');
  assert.equal(labels.roleOf('/root/review/api_tests'), 'api_tests');
});

test('an agent shows its activity while working, and its answer or error once settled', () => {
  assert.equal(labels.activityLine({ status: 'running', activity: 'npm test', result: null }), 'npm test');
  assert.equal(labels.activityLine({ status: 'running', activity: null, result: null }), 'Working');
  assert.equal(labels.activityLine({ status: 'completed', activity: 'npm test', result: '\nAll tests pass.\nDetails follow.' }), 'All tests pass.');
  assert.equal(labels.activityLine({ status: 'interrupted', activity: null, result: null }), 'Stopped');
});

test('the spawn row counts the run\'s agents, and team messages lose their envelope', () => {
  assert.equal(labels.spawnSummary(1, true), 'Kicked off 1 subagent');
  assert.equal(labels.spawnSummary(3, false), 'Ran 3 subagents');
  assert.deepEqual(labels.messagePayload('Message Type: NEW_TASK\nTask name: /root/a\nSender: /root\nPayload:\nDo it\nwell'), { payload: 'Do it\nwell', sender: '/root' });
  assert.equal(labels.messagePayload('A plain message'), null);
});
