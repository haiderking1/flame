import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';

const request = { accountId: 'test', access: 'test-secret', sessionId: 'test-session',
  settings: { modelId: 'gpt-6.1-sol', effort: 'high', serviceTier: 'default' },
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }] };
const reasoning = { type: 'reasoning', id: 'rs_test', encrypted_content: 'opaque', summary: [] };
const message = { type: 'message', id: 'msg_test', role: 'assistant', phase: 'final_answer',
  content: [{ type: 'output_text', text: 'Hello', annotations: [] }] };
const completed = (context) => ({ type: 'response.completed', response: { status: 'completed',
  ...(context !== undefined ? { reasoning: { context } } : {}), output: [reasoning, message] } });
const stream = (...events) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
const run = (client, settings = request.settings) => client.run({ ...request, settings }, () => {}, new AbortController().signal);

test('GPT-6.1 Sol explicitly enables all-turn reasoning at every effort, including provider-default effort', async () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', null]) {
    const client = new CodexInferenceClient(async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.reasoning.context, 'all_turns');
      assert.equal(body.reasoning.effort, effort ?? undefined);
      assert.equal(body.reasoning.summary, effort === null ? undefined : 'auto');
      assert.equal(body.store, false);
      assert.ok(body.include.includes('reasoning.encrypted_content'));
      return stream(completed('all_turns'));
    });
    const result = await run(client, { ...request.settings, effort });
    assert.deepEqual(result.output, [reasoning, message]);
  }
});

test('other models keep their existing reasoning defaults and need no context confirmation', async () => {
  for (const modelId of ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'future-model']) {
    for (const effort of ['high', null]) {
      const client = new CodexInferenceClient(async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.deepEqual(body.reasoning, effort === null ? undefined : { effort: 'high', summary: 'auto' });
        return stream(completed(undefined));
      });
      assert.equal((await run(client, { ...request.settings, modelId, effort })).text, 'Hello');
    }
  }
});

test('context confirmation survives metadata-only completion and response.done', async () => {
  for (const type of ['response.completed', 'response.done']) {
    const client = new CodexInferenceClient(async () => stream(
      { type: 'response.created', response: { reasoning: { context: 'all_turns' } } },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      { type: 'response.output_item.done', output_index: 1, item: message },
      { type, response: { status: 'completed', output: [] } },
    ));
    assert.deepEqual((await run(client)).output, [reasoning, message]);
  }
});

test('missing, invalid or downgraded reasoning modes fail without retries or provider-detail exposure', async () => {
  const scenarios = [
    [completed(undefined)],
    [completed(null)],
    [completed('current_turn')],
    [completed('private-provider-detail')],
    [{ type: 'response.created', response: { reasoning: { context: 'current_turn' } } }, completed('all_turns')],
    [{ type: 'response.in_progress', response: { reasoning: { context: 'all_turns' } } }, completed('current_turn')],
  ];
  for (const events of scenarios) {
    let calls = 0;
    const client = new CodexInferenceClient(async () => { calls++; return stream(...events); });
    await assert.rejects(run(client), error => /reasoning across turns/.test(error.message)
      && /not replayed/.test(error.message) && !error.message.includes('private-provider-detail'));
    assert.equal(calls, 1);
  }
});
