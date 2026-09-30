import assert from 'node:assert/strict';

export async function watchImagePreviewHandoff(evaluate, wait) {
  await wait("[...document.querySelectorAll('.image-gallery--draft .image-thumbnail img')].length > 0 && [...document.querySelectorAll('.image-gallery--draft .image-thumbnail')].every(tile => tile.querySelector('img')?.complete && tile.querySelector('img')?.naturalWidth > 0)");
  await evaluate(`(() => {
    const originals = new Map([...document.querySelectorAll('.image-gallery--draft img')].map(image => [image.alt, image.src]));
    window.previewHandoff = { gaps: [], changes: [] };
    window.previewObserver?.disconnect();
    window.previewObserver = new MutationObserver(() => {
      for (const tile of document.querySelectorAll('.session-message--user .image-thumbnail__open')) {
        const name = tile.title;
        if (!originals.has(name)) continue;
        const image = tile.querySelector('img');
        if (!image) window.previewHandoff.gaps.push(name);
        else if (image.src !== originals.get(name)) window.previewHandoff.changes.push(name);
      }
    });
    window.previewObserver.observe(document.body, {subtree:true, childList:true, attributes:true});
  })()`);
  return async () => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const result = await evaluate('(() => { window.previewObserver.disconnect(); return window.previewHandoff; })()');
    assert.deepEqual(result.gaps, [], 'sending and acknowledgement never replace loaded thumbnails with an empty tile');
    assert.deepEqual(result.changes, [], 'the already decoded preview URL survives the composer-to-chat and saved-message handoffs');
  };
}
