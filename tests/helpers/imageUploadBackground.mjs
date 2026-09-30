import assert from 'node:assert/strict';

export function captureImageUploads(session, port) {
  const requests = [], failures = new Set(), gated = new Set(), pending = new Map();
  session.webRequest.onBeforeRequest({ urls: [`http://127.0.0.1:${port}/*`] }, (details, callback) => {
    const url = new URL(details.url);
    if (details.method !== 'POST' || url.pathname !== '/images/upload') { callback({}); return; }
    const request = { requestId: details.id, ...Object.fromEntries(url.searchParams) }; requests.push(request);
    if (failures.delete(request.name)) { callback({ cancel: true }); return; }
    if (gated.has(request.name)) { pending.set(request.name, callback); return; }
    callback({});
  });
  session.webRequest.onCompleted({ urls: [`http://127.0.0.1:${port}/*`] }, details => {
    const target = requests.find(request => request.requestId === details.id); if (target) target.status = details.statusCode;
  });
  session.webRequest.onErrorOccurred({ urls: [`http://127.0.0.1:${port}/*`] }, details => {
    const target = requests.find(request => request.requestId === details.id); if (target) target.error = details.error;
  });
  return {
    requests, failOnce(name) { failures.add(name); },
    gate(names) { for (const name of names) gated.add(name); },
    held(name) { return pending.has(name); },
    release(name, cancel = false) { gated.delete(name); const callback = pending.get(name); pending.delete(name); callback?.({ cancel }); },
    close() { for (const name of [...pending.keys()]) this.release(name, true); session.webRequest.onBeforeRequest(null); session.webRequest.onCompleted(null); session.webRequest.onErrorOccurred(null); },
  };
}

export async function checkBackgroundRetry({ evaluate, wait, click, add, capture }) {
  capture.failOnce('retry.png');
  await add(['retry.png']);
  await wait(() => capture.requests.some(request => request.name === 'retry.png' && request.error));
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await evaluate("document.querySelector('.composer-actions__send').disabled"), false);
  const first = capture.requests.filter(request => request.name === 'retry.png');
  assert.equal(first.length, 1);
  capture.gate(['retry.png']);
  await click('.composer-actions__send');
  await wait(() => capture.held('retry.png'));
  const retried = capture.requests.filter(request => request.name === 'retry.png');
  assert.equal(retried.length, 2);
  assert.equal(retried[0].id, retried[1].id, 'Send retries a failed background upload with its durable attachment identity');
  await wait("!!document.querySelector('.session-message--user[aria-busy=true] [aria-label=\"Preview retry.png\"]')");
  assert.equal(await evaluate("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length"), 0, 'the image moves to chat while its upload is still held');
  capture.release('retry.png', true);
  await wait("document.querySelector('[aria-label=\"Remove retry.png\"]')?.disabled === false && !!document.querySelector('.composer__hint')");
  assert.equal(await evaluate("document.querySelectorAll('.session-message--user[aria-busy=true]').length"), 0, 'a failed send rolls back its pending chat message');
  capture.gate(['retry.png']);
  await click('.composer-actions__send');
  await wait(() => capture.held('retry.png'));
  await wait("!!document.querySelector('.session-message--user[aria-busy=true]')");
  await click('[aria-label="Stop sending"]');
  await wait("document.querySelector('[aria-label=\"Remove retry.png\"]')?.disabled === false");
  assert.equal(await evaluate("document.querySelectorAll('.session-message--user[aria-busy=true]').length"), 0, 'stopping restores the attachment and removes the pending row');
  await click('[aria-label="Remove retry.png"]');
  capture.release('retry.png', true);
  await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 0");
  await wait("document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false");
}

export async function checkUploadConcurrency({ evaluate, wait, click, add, capture }) {
  const names = ['queue1.png', 'queue2.png', 'queue3.png', 'queue4.png'];
  capture.gate(names);
  try {
    await add(names);
    await wait(() => names.slice(0, 3).every(name => capture.held(name)));
    assert.equal(await evaluate("document.querySelector('.composer-actions__send').disabled"), false);
    assert.equal(capture.requests.filter(request => names.includes(request.name)).length, 3, 'only three concurrent POST transports start');
    assert.equal(capture.requests.some(request => request.name === 'queue4.png'), false);
    await click('.composer-actions__send');
    await wait("document.querySelector('[aria-label=\"Stop sending\"]') !== null");
    await wait("document.querySelectorAll('.session-message--user[aria-busy=true] .image-thumbnail').length === 4");
    assert.equal(await evaluate("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length"), 0);
    assert.equal(capture.requests.filter(request => names.includes(request.name)).length, 3, 'Send waits for existing uploads');
    await click('[aria-label="Stop sending"]');
    await wait("document.querySelector('.composer-actions__send')?.disabled === false && !document.querySelector('textarea').readOnly");
    await click('[aria-label="Remove queue4.png"]');
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 3");
    await wait("document.querySelector('[aria-label=\"Remove queue1.png\"]')?.disabled === false");
    await click('[aria-label="Remove queue1.png"]');
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 2");
    capture.release('queue1.png', true);
    capture.release('queue2.png'); capture.release('queue3.png');
    await wait(() => ['queue2.png', 'queue3.png'].every(name => capture.requests.some(request => request.name === name && request.status === 200)));
    assert.equal(capture.requests.some(request => request.name === 'queue4.png'), false, 'removed queued attachment never starts a POST');
    await wait("document.querySelector('[aria-label=\"Remove queue2.png\"]')?.disabled === false");
    await click('[aria-label="Remove queue2.png"]');
    await wait("document.querySelector('[aria-label=\"Remove queue3.png\"]')?.disabled === false");
    await click('[aria-label="Remove queue3.png"]');
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 0");
    await wait("document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false");
  } finally { for (const name of names) capture.release(name, true); }
}
