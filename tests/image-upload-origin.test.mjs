import assert from 'node:assert/strict';
import test from 'node:test';
import { needsImageUploadOrigin } from '../dist/main/imageUploadOriginPolicy.js';

test('file upload Origin attestation is restricted to the trusted top frame and authenticated loopback endpoint', () => {
  const backend = 'ws://127.0.0.1:43123/rpc?token=secret';
  const renderer = 'file:///flame/dist/renderer/index.html';
  const request = { url: 'http://127.0.0.1:43123/images/upload?token=secret&id=image', method: 'POST' };
  const eligible = (changes = {}, frame = renderer, trusted = true) => needsImageUploadOrigin({ ...request, ...changes }, backend, frame, renderer, trusted);
  assert.equal(eligible(), true);
  assert.equal(eligible({ origin: 'null' }), true);
  assert.equal(eligible({ method: 'OPTIONS' }), true);
  for (const changes of [{ origin: 'https://evil.example' }, { origin: 'file://' }, { method: 'GET' },
    { url: 'http://127.0.0.1:43124/images/upload?token=secret' }, { url: 'http://localhost:43123/images/upload?token=secret' },
    { url: 'http://127.0.0.1:43123/rpc?token=secret' }, { url: 'http://127.0.0.1:43123/images/upload?token=wrong' },
    { url: 'http://127.0.0.1:43123/images/upload?token=secret&token=wrong' },
    { url: 'http://user@127.0.0.1:43123/images/upload?token=secret' }, { url: 'invalid' }]) assert.equal(eligible(changes), false);
  assert.equal(eligible({}, renderer, false), false);
  assert.equal(eligible({}, 'file:///other.html'), false);
  assert.equal(eligible({}, 'https://evil.example'), false);
});
