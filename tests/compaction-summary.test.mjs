import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSummary } from '../dist/backend/compaction/summary.js';
import { estimateTokens } from '../dist/backend/compaction/estimate.js';
import { inferenceUsage } from '../dist/backend/turns/usage.js';
import { ContextOverflow, providerFailure, readProviderError } from '../dist/backend/turns/provider-errors.js';

const request = { accountId: 'test', access: 'secret', sessionId: 'original',
  settings: { modelId: 'gpt-6.1-sol', effort: 'high', serviceTier: 'priority' }, input: [], tools: true };
const user = text => ({ role: 'user', content: [{ type: 'input_text', text }] });

test('summary folds oversized unicode history into bounded requests with isolated caches and prior summaries', async () => {
  const requests = [];
  const client = { async run(value) {
    requests.push(value);
    assert.equal(value.tools, false);
    assert.equal(value.settings.effort, null);
    assert.equal(value.settings.serviceTier, 'default');
    assert.ok(estimateTokens(value.input) < 8000 * 0.9);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(JSON.stringify(value.input)));
    if (requests.length > 1) assert.match(value.input[0].content[0].text, /Previous conversation summary/);
    return { text: `## Goal\nContinue safely.\n## Progress\nBatch ${requests.length}`, output: [] };
  } };
  const result = await generateSummary(client, request, [user('😀'.repeat(12000))], 8000, new AbortController().signal);
  assert.ok(requests.length > 2);
  assert.match(result, new RegExp(`Batch ${requests.length}`));
  assert.equal(new Set(requests.map(value => value.sessionId)).size, requests.length);
  assert.ok(requests.every(value => value.sessionId !== request.sessionId && value.promptCacheKey === value.sessionId));
});

test('summary preserves actual image input and rejects empty, oversized, tool-producing, and cancelled results', async () => {
  const image = { type: 'input_image', image_url: 'data:image/png;base64,actual', detail: 'low' };
  await generateSummary({ async run(value) {
    assert.deepEqual(value.input[0].content.find(part => part.type === 'input_image'), image);
    return { text: '## Goal\nUse the supplied image.', output: [] };
  } }, request, [{ role: 'user', content: [image] }], 20000, new AbortController().signal);
  for (const result of [ { text: '', output: [] }, { text: 'x'.repeat(65000), output: [] },
    { text: 'summary', output: [{ type: 'function_call', name: 'bash' }] } ]) {
    await assert.rejects(generateSummary({ run: async () => result }, request, [user('history')], 8000,
      new AbortController().signal), /empty or oversized|tool call/);
  }
  const controller = new AbortController();
  await assert.rejects(generateSummary({ async run() { controller.abort(); return { text: 'summary', output: [] }; } },
    request, [user('history')], 8000, controller.signal), { name: 'AbortError' });
  await assert.rejects(generateSummary({ run: async () => assert.fail('must not send') }, request,
    [user('history')], 1000, new AbortController().signal), /too small/);
});

test('usage includes cached and reasoning tokens once and ignores malformed accounting', () => {
  assert.deepEqual(inferenceUsage({ input_tokens: 1000, output_tokens: 200, total_tokens: 1200,
    input_tokens_details: { cached_tokens: 900 }, output_tokens_details: { reasoning_tokens: 180 } }),
  { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedInputTokens: 900, reasoningTokens: 180 });
  for (const usage of [null, {}, { input_tokens: -1, output_tokens: 1, total_tokens: 0 },
    { input_tokens: 10, output_tokens: 2, total_tokens: 99 }, { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    { input_tokens: 1.5, output_tokens: 1, total_tokens: 2.5 }]) assert.equal(inferenceUsage(usage), undefined);
});

test('provider overflow recognition is explicit and bounded error bodies never expose provider details', async () => {
  assert.ok(providerFailure({ code: 'context_length_exceeded', message: 'private' }) instanceof ContextOverflow);
  assert.ok(!(providerFailure({ code: 'other', message: 'context window exceeded private' }) instanceof ContextOverflow));
  assert.ok(!providerFailure({ code: 'other', message: 'private' }).message.includes('private'));
  assert.deepEqual(await readProviderError(new Response(JSON.stringify({ error: { code: 'context_length_exceeded' } }))),
    { code: 'context_length_exceeded' });
  assert.equal(await readProviderError(new Response('invalid json')), undefined);
  assert.equal(await readProviderError(new Response('x'.repeat(17000))), undefined);
});
