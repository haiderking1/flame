import { request } from 'node:http';
import { Effect, Layer } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';
import WebSocket from 'ws';
import { BackendRpc } from '../../dist/contracts/backend.js';
import { hashImage } from '../../dist/backend/images/files.js';

export function uploadUrl(location, id, data, values = {}) {
  return `/images/upload?${new URLSearchParams({ token: 'test-token', ...location, id,
    name: 'reference.png', bytes: String(data.length), sha256: hashImage(data), ...values })}`;
}

export function http(port, path, data, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, origin: 'null', ...(data === undefined ? {} : {
      'content-type': 'application/octet-stream', 'content-length': data.length,
    }), ...options.headers };
    for (const name of options.omitHeaders ?? []) delete headers[name];
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'POST', headers, agent: false }, response => {
      const chunks = [];
      response.on('data', data => chunks.push(data));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', error => reject(new Error(`HTTP ${options.method ?? 'POST'} ${path}: ${error.code ?? error.message}`, { cause: error }))); req.end(data);
  });
}

export function rpc(port, work) {
  const socket = Socket.layerWebSocket(`ws://127.0.0.1:${port}/rpc?token=test-token`).pipe(
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, url => new WebSocket(url, { headers: { Origin: 'file://' } }))),
  );
  const protocol = RpcClient.layerProtocolSocket().pipe(Layer.provide(socket), Layer.provide(RpcSerialization.layerJson));
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* RpcClient.make(BackendRpc);
    return yield* work(client);
  }).pipe(Effect.provide(protocol))));
}

export function abortBody(port, path, data) {
  return new Promise(resolve => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: {
      host: `127.0.0.1:${port}`, origin: 'null', 'content-type': 'application/octet-stream', 'content-length': data.length,
    } });
    req.on('error', () => resolve()); req.on('response', response => { response.resume(); resolve(); });
    req.write(data.subarray(0, 1));
    setTimeout(() => { req.destroy(); resolve(); }, 30);
  });
}
