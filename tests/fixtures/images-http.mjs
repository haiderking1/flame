import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect } from 'effect';
import { startServer } from '../../dist/backend/server.js';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { MAX_IMAGE_BYTES } from '../../dist/contracts/image-types.js';
import { hashImage } from '../../dist/backend/images/files.js';
import { png } from '../helpers/images.mjs';
import { uploadUrl, http, rpc, abortBody } from '../helpers/image-http.mjs';

const root = process.argv[2], filename = join(root, 'flame.sqlite'), work = join(root, 'work');
mkdirSync(work);
const projects = new ProjectStore(filename), project = projects.add(work);
const location = { projectId: project.id, sessionId: randomUUID() };
const repository = new SessionRepository(join(root, 'projects'), projects);
let server;
async function open() {
  let ready;
  const port = new Promise(resolve => { ready = resolve; }), controller = new AbortController();
  const running = Effect.runPromise(Effect.scoped(startServer({ filename, token: 'test-token', origin: 'file://',
    openBrowser: async () => assert.fail('Uploads must not request provider OAuth'), ready })), { signal: controller.signal }).catch(error => {
    if (!controller.signal.aborted) throw error;
  });
  server = { port: await port, close: async () => { controller.abort(); await running; } };
}
const denied = response => assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(response));

try {
  await open();
  const data = png(400, 200), id = randomUUID(), path = uploadUrl(location, id, data);
  // Production file windows use the opaque "null" HTTP Origin; RPC websocket
  // authentication still requires its original file:// Origin.
  for (const change of [{ token: 'wrong' }, { token: '' }]) assert.equal((await http(server.port, uploadUrl(location, id, data, change), data)).status, 403);
  for (const headers of [{ origin: 'https://evil.invalid' }, { host: `localhost:${server.port}` }]) assert.equal((await http(server.port, path, data, { headers })).status, 403);
  assert.equal((await http(server.port, path, data, { omitHeaders: ['origin'] })).status, 403);
  assert.equal((await http(server.port, path, data, { method: 'GET' })).status, 405);
  const preflight = await http(server.port, path, undefined, { method: 'OPTIONS', headers: {
    'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'null');
  denied(await http(server.port, path, data, { headers: { 'content-type': 'image/png' } }));
  denied(await http(server.port, path, data, { headers: { 'content-length': MAX_IMAGE_BYTES + 1 } }));
  denied(await http(server.port, uploadUrl(location, randomUUID(), data, { bytes: '' }), data));
  denied(await http(server.port, uploadUrl(location, randomUUID(), data, { sha256: '0'.repeat(64) }), data));
  denied(await http(server.port, uploadUrl({ ...location, projectId: randomUUID() }, randomUUID(), data), data));
  denied(await http(server.port, uploadUrl(location, 'invalid-id', data), data));
  assert.equal(repository.list().sessions.length, 0);
  const first = await http(server.port, path, data);
  assert.equal(first.status, 200, first.body);
  const info = JSON.parse(first.body);
  assert.equal(info.id, id); assert.equal(info.sha256, hashImage(data)); assert.equal(info.bytes, data.length);
  assert.equal(info.width, 400); assert.equal(info.height, 200);
  assert.ok(!first.body.includes(root), 'private staging filesystem paths stay backend-only');
  assert.equal(repository.list().sessions.length, 0, 'successful upload does not create a session');
  const repeated = await http(server.port, path, data);
  assert.equal(repeated.status, 200); assert.deepEqual(JSON.parse(repeated.body), info);
  const chunkedId = randomUUID();
  const chunked = await http(server.port, uploadUrl(location, chunkedId, data), data,
    { omitHeaders: ['content-length'], headers: { 'transfer-encoding': 'chunked' } });
  assert.equal(chunked.status, 200, chunked.body);
  await rpc(server.port, client => client['images.discard']({ ...location, id: chunkedId }));
  denied(await http(server.port, uploadUrl(location, id, data, { name: 'collision.png' }), data));
  const other = png(401, 200);
  denied(await http(server.port, uploadUrl(location, id, other), other));
  assert.deepEqual(await rpc(server.port, client => client['images.staged']({ ...location, ids: [id] })), [info]);
  await server.close(); await open();
  assert.equal(repository.list().sessions.length, 0);
  assert.deepEqual(await rpc(server.port, client => client['images.staged']({ ...location, ids: [id] })), [info]);
  // Metadata-only ready-ID recovery and adoption preserve prepared bytes. Send
  // creates the session first; adoption must not decode or upload the image again.
  await rpc(server.port, client => client['sessions.create'](location));
  await rpc(server.port, client => client['images.adopt']({ ...location, ids: [id] }));
  assert.deepEqual(repository.use(location, db => db.images.info(id)), info);
  const prepared = join(root, 'projects', project.id, 'sessions', location.sessionId, 'images', `${id}.model`);
  assert.equal(hashImage(readFileSync(prepared)), info.modelSha256);
  await rpc(server.port, client => client['images.adopt']({ ...location, ids: [id] }));
  assert.equal(hashImage(readFileSync(prepared)), info.modelSha256);
  await rpc(server.port, client => client['images.discard']({ ...location, id }));
  assert.equal(repository.use(location, db => db.images.info(id)), null);
  assert.deepEqual(await rpc(server.port, client => client['images.staged']({ ...location, ids: [id] })), []);
  denied(await http(server.port, path, data));
  const draft = { ...location, sessionId: randomUUID() }, aborted = randomUUID();
  await abortBody(server.port, uploadUrl(draft, aborted, data), data);
  let recovered;
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(50);
    recovered = await http(server.port, uploadUrl(draft, aborted, data), data);
    if (recovered.status === 200 || !recovered.body.includes('already uploading')) break;
  }
  assert.equal(recovered.status, 200, recovered.body);
  await rpc(server.port, client => client['images.discard']({ ...draft, id: aborted }));
  assert.equal(repository.list().sessions.length, 1, 'retrying or removing a draft upload does not create its session');
  const policy = readFileSync(new URL('../../src/renderer/index.html', import.meta.url), 'utf8');
  assert.match(policy, /connect-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  console.log('FLAME_IMAGES_HTTP_OK');
} finally { await server?.close(); projects.close(); }
