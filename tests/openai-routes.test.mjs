import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { CodexInferenceClient } from '../dist/backend/turns/client.js';
import { CodexModelsClient, CATALOG_URL } from '../dist/backend/models/client.js';
import { parseModels } from '../dist/backend/models/payload.js';
import { CodexUsage } from '../dist/backend/usage/service.js';
import { UsageStore } from '../dist/backend/usage/store.js';

const settings = { modelId: 'model-a', effort: null, serviceTier: 'default' };
const chatgpt = { method: 'chatgpt', access: 'plan-token', accountId: null };
const codex = { method: 'codex', access: 'codex-token', accountId: 'account' };
const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
const done = [{ type: 'response.output_item.done', output_index: 0, item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] } },
  { type: 'response.completed', response: { status: 'completed', output: [] } }];
async function run(credentials, response) {
  const requests = [];
  const client = new CodexInferenceClient(async (url, init) => { requests.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return typeof response === 'function' ? response() : response; });
  const result = await client.run({ ...credentials, sessionId: 'session-1', settings, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }] }, () => {}, new AbortController().signal)
    .catch(error => error);
  return { requests, result };
}

test('Sign in with ChatGPT streams from the public Responses API without ChatGPT backend headers', async () => {
  const plan = await run(chatgpt, sse(done));
  assert.equal(plan.result.text, 'Hi');
  assert.equal(plan.requests[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(plan.requests[0].headers, { Authorization: 'Bearer plan-token', 'User-Agent': 'Flame', 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  const body = plan.requests[0].body;
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  for (const rejected of ['max_output_tokens', 'temperature', 'prompt_cache_retention', 'truncation', 'metadata', 'user', 'previous_response_id']) assert.equal(rejected in body, false, rejected);

  const legacy = await run(codex, sse(done));
  assert.equal(legacy.requests[0].url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(legacy.requests[0].headers['ChatGPT-Account-Id'], 'account');
  assert.equal(legacy.requests[0].headers['session-id'], 'session-1');
  assert.equal(legacy.requests[0].headers.originator, 'flame');
});

test('ChatGPT plan errors explain themselves, whether rejected up front or failed mid-stream', async () => {
  const error = (code, status, extra = {}) => Response.json({ error: { code, message: 'secret detail', ...extra } }, { status });
  const limit = await run(chatgpt, error('subscription_sharing_usage_limit_exceeded', 429));
  assert.match(limit.result.message, /limit of your ChatGPT plan.*Settings → Usage \(https:\/\/chatgpt\.com\/settings\/usage\)/);
  const failed = await run(chatgpt, sse([{ type: 'response.failed', response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } } }]));
  assert.match(failed.result.message, /limit of your ChatGPT plan/);
  assert.match((await run(chatgpt, error('subscription_sharing_usage_unavailable', 503))).result.message, /unavailable right now/);
  assert.match((await run(chatgpt, error('subscription_sharing_user_not_eligible', 403))).result.message, /legacy Codex sign-in/);
  assert.match((await run(chatgpt, error('subscription_sharing_unsupported_capability', 400, { param: 'tools' }))).result.message, /does not support "tools"/);
  assert.match((await run(chatgpt, error('subscription_sharing_invalid_user', 401))).result.message, /Sign in again in Providers/);
  assert.match((await run(chatgpt, error('chatpass_v2_scope_not_authorized', 403))).result.message, /not allowed to use your ChatGPT plan/);
  const admission = await run(chatgpt, Response.json({ detail: 'Direct routing unavailable' }, { status: 503 }));
  assert.match(admission.result.message, /HTTP 503/);
  for (const outcome of [limit, admission]) assert.ok(!outcome.result.message.includes('secret detail'));
  const overflow = await run(chatgpt, error('context_length_exceeded', 400));
  assert.equal(overflow.result.constructor.name, 'ContextOverflow');
});

test('the model catalog comes from the public API for ChatGPT sign-ins, and may omit order and reasoning levels', async () => {
  const urls = [];
  const client = new CodexModelsClient(async (url, init) => { urls.push({ url, headers: init.headers });
    return Response.json({ models: [{ slug: 'second', display_name: 'Second', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'third', display_name: 'Third', visibility: 'list' }] }); });
  const catalog = await client.read({ key: 'k', epoch: 1, ...chatgpt }, null, new AbortController().signal);
  assert.equal(urls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(urls[0].headers['ChatGPT-Account-Id'], undefined);
  assert.deepEqual(catalog.models.map(model => [model.id, model.reasoningLevels.length, model.defaultReasoning]), [['second', 0, null], ['third', 0, null]]);
  await client.read({ key: 'k', epoch: 1, ...codex }, null, new AbortController().signal);
  assert.equal(urls[1].url, CATALOG_URL);
  assert.throws(() => parseModels({ models: [{ slug: 'bad', display_name: 'Bad', visibility: 'list', priority: 'first' }] }), /invalid model catalog/);
});

test('usage for a ChatGPT sign-in is left to ChatGPT: no backend reads, no banked resets', async () => {
  const auth = new EventEmitter();
  auth.usageSession = () => ({ key: 'plan-key', epoch: 1, ...chatgpt });
  let calls = 0;
  const count = async () => { calls++; throw new Error('must not be called'); };
  const store = new UsageStore(':memory:');
  const usage = new CodexUsage(auth, store, { read: count, credits: count, consume: count });
  try {
    assert.deepEqual(usage.state, { connected: true, managedInChatGPT: true, snapshot: null, message: null });
    await usage.refresh(true);
    await assert.rejects(usage.prepare(), /ChatGPT shows how much of your plan Flame has used/);
    await assert.rejects(usage.confirm('id'), /ChatGPT shows/);
    assert.equal(calls, 0);
  } finally { await usage.close(); store.close(); }
});
