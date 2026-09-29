import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { hashImage } from '../dist/backend/images/files.js';
import { harness, isSummary, message, summary } from './helpers/compaction.mjs';

test('summarizing an older attached image forwards its actual pixels and preserves the original attachment',
  { timeout: 15000, skip: process.platform === 'win32' }, async t => {
    let visualSummaryCalls = 0;
    const h = harness(t, body => {
      assert.ok(isSummary(body));
      const content = body.input[0].content;
      const images = content.filter(part => part.type === 'input_image');
      if (images.length) {
        visualSummaryCalls++;
        assert.match(images[0].image_url, /^data:image\/png;base64,/);
        assert.equal(Buffer.from(images[0].image_url.split(',')[1], 'base64').length, pixel.length);
        assert.ok(content.some(part => part.type === 'input_text' && part.text.includes('An image attached')));
        assert.ok(!content.some(part => part.type === 'input_text' && part.text.includes('data:image/png;base64,')));
      }
      return [message(summary)];
    }, 40000);
    // A pre-normalized one-pixel image fixture exercises durable attachment
    // storage and inference replay; normalization has no bearing on compaction.
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9YkAAAAASUVORK5CYII=', 'base64');
    const id = randomUUID(), sha = hashImage(pixel);
    h.sessions.images(h.location, store => {
      store.begin(id, 'reference.png', pixel.length, sha);
      store.chunk(id, 0, pixel.toString('base64'));
      store.finish(id, store.source(id), { data: pixel, originalMime: 'image/png', mimeType: 'image/png', width: 1, height: 1, modelWidth: 1, modelHeight: 1 });
    });
    h.seed(40000, [id]);
    await h.compact();
    const done = await h.done();
    assert.equal(done.status, 'completed', h.transportErrors[0]?.stack ?? done.message);
    assert.equal(visualSummaryCalls, 1);
    assert.equal(h.checkpoints().length, 1);
    assert.equal(h.sessions.images(h.location, store => store.info(id)).sha256, sha);
    assert.ok(!JSON.stringify(h.context()).includes('data:image/png;base64,'));
    await h.restart();
    assert.equal(h.sessions.images(h.location, store => store.info(id)).sha256, sha);
  });
