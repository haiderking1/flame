import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, isSummary, summary, message, completed } from './helpers/compaction.mjs';
import { CompactionRuntime } from '../dist/backend/compaction/runtime.js';
import { ContextOverflow } from '../dist/backend/turns/provider-errors.js';
import { estimateTokens } from '../dist/backend/compaction/estimate.js';

test('measured reasoning context triggers ninety-percent compaction on a follow-up after restart', { timeout: 15000 }, async t => {
  let responses = 0;
  const h = harness(t, body => {
    if (isSummary(body)) return [message(summary)];
    return completed([message(`Answer ${++responses}`)], responses === 1 ? 17950 : 2000);
  });
  h.seed(1000);
  await h.start('Record the plan.');
  assert.equal((await h.done()).status, 'completed');
  assert.equal(h.checkpoints().length, 0);
  assert.equal(h.sessions.read(h.location).context.estimatedTokens, 17950);
  await h.restart();
  await h.start('Continue with this clarification: ' + 'x'.repeat(800));
  assert.equal((await h.done()).status, 'completed');
  assert.equal(h.checkpoints().length, 1);
  assert.equal(h.checkpoints()[0].trigger, 'auto');
  assert.ok(h.checkpoints()[0].tokensBefore >= 18000);
  assert.equal(h.requests.filter(isSummary).length, 1);
});

test('restored accounting counts fresh ledger and instruction growth and caps overflow recovery across steps', async () => {
  const user = text => ({ role: 'user', content: [{ type: 'input_text', text }] });
  let ledger = [user('prior operations')], requests = 0, summaries = 0;
  const input = [user('x'.repeat(8000)), { role: 'assistant', content: 'old answer' }, user('continue')];
  const request = { accountId: 'test', access: 'test', sessionId: 'test',
    settings: { modelId: 'gpt-6.1-sol', effort: null, serviceTier: 'default' }, input };
  const runtime = new CompactionRuntime({ async run(value) {
    if (value.instructionsOverride) { summaries++; return { text: 'Earlier work completed.', output: [] }; }
    requests++;
    if (requests === 1 || requests === 3) throw new ContextOverflow('full');
    return { text: 'success', output: [], usage: undefined };
  } }, request, input, 20000, 0, { ledger: () => ledger, save() {}, phase() {} }, new AbortController().signal);
  runtime.restoreAnchor({ tokens: 12000, count: input.length, ledgerTokens: estimateTokens(ledger), overhead: 200 });
  runtime.setOverhead(300);
  assert.equal(runtime.info().estimatedTokens, 12100);
  ledger = [...ledger, user('new job finished')];
  assert.ok(runtime.info().estimatedTokens > 12100);
  assert.equal((await runtime.run(request, () => {})).text, 'success');
  await assert.rejects(runtime.run(request, () => {}), ContextOverflow);
  assert.equal(summaries, 1);
  assert.equal(requests, 3);
});
