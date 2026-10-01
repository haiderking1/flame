import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, ipcMain, session } from 'electron';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { installImageUploadOrigin } from '../../dist/main/imageUploadOrigin.js';
import { startServer } from '../../dist/backend/server.js';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { png } from '../helpers/images.mjs';
import { captureImageUploads, checkBackgroundRetry, checkUploadConcurrency } from '../helpers/imageUploadBackground.mjs';
import { watchImagePreviewHandoff } from '../helpers/imagePreviewHandoff.mjs';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const filename = join(app.getPath('userData'), 'flame.sqlite');
  const projects = new ProjectStore(filename), work = join(app.getPath('userData'), 'Project'); mkdirSync(work, { recursive: true });
  const project = projects.add(work), location = { projectId: project.id, sessionId: randomUUID() };
  const repository = new SessionRepository(join(app.getPath('userData'), 'projects'), projects);
  repository.create(location, { modelId: 'alpha', effort: null, serviceTier: 'default' });
  repository.use(location, db => db.rename(0, 'Images test'));
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [{ slug: 'alpha', display_name: 'Alpha', priority: 0,
    visibility: 'list', default_reasoning_level: null, supported_reasoning_levels: [], input_modalities: ['text', 'image'], context_window: 200000 }] }));
  writeFileSync(join(work, 'read-source.png'), png(640, 240));
  let requests = 0;
  const inferenceClient = { async run(request) {
    requests++;
    const images = request.input.flatMap(item => Array.isArray(item.output) ? item.output : item.content ?? []).filter(part => part.type === 'input_image');
    assert.equal(images.length, requests === 1 ? 3 : requests === 4 ? 2 : 1); assert.ok(images.every(part => part.image_url.startsWith('data:image/png;base64,')));
    if (requests === 3) return { text: '', output: [{ type: 'function_call', id: 'fc_read-image', call_id: 'read-image', name: 'read', arguments: JSON.stringify({ path: 'read-source.png', offset: null, limit: null }) }] };
    if (requests === 4) {
      assert.ok(Array.isArray(request.input.find(item => item.type === 'function_call_output' && item.call_id === 'read-image').output));
      return { text: 'I read the image from disk.', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I read the image from disk.' }] }] };
    }
    assert.ok(requests <= 2, 'no unexpected provider replay');
    return { text: 'I can see all three images.', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I can see all three images.' }] }] };
  } };
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  const server = Effect.runPromise(Effect.scoped(startServer({ filename, token: 'test-token', origin: 'file://', modelsClient, inferenceClient,
    openBrowser: async () => assert.fail('No OAuth requested'), ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=test-token`);
  installImageUploadOrigin(session.defaultSession, `ws://127.0.0.1:${port}/rpc?token=test-token`);
  const window = await createWindow();
  const capture = captureImageUploads(window.webContents.session, port);
  const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Renderer script failed: ${code}`, { cause: error }); });
  const wait = async code => { for (let i = 0; i < 300; i++) { if (typeof code === 'function' ? await code() : await evaluate(code)) return; await delay(20); }
    const composer = await evaluate("({send:document.querySelector('.composer-actions__send')?.outerHTML,textarea:document.querySelector('.composer__input')?.outerHTML,text:document.querySelector('main')?.textContent ?? document.body.textContent})");
    assert.fail(`Timed out: ${code}\nComposer: ${JSON.stringify(composer)}\nPOSTs: ${JSON.stringify(capture.requests.map(({name,id,status,error})=>({name,id,status,error})))}`);
  };
  const uploaded = names => wait(() => names.every(name => capture.requests.some(request => request.name === name && request.status === 200)));
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const reload = async () => { const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded; };
  const image = png(640, 240).toString('base64');
  const file = name => `new File([Uint8Array.from(atob(${JSON.stringify(image)}), char => char.charCodeAt(0))], ${JSON.stringify(name)}, {type:'image/png'})`;
  const add = names => evaluate(`(() => { const transfer = new DataTransfer(); ${names.map(name => `transfer.items.add(${file(name)});`).join(' ')} document.querySelector('form.composer').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer})); })()`);
  const traceSend = () => evaluate(`(() => {
    window.sendTrace = { start: performance.now(), errors: [], message: null };
    window.sendObserver?.disconnect();
    window.sendObserver = new MutationObserver(() => {
      for (const node of document.querySelectorAll('.composer__images-error, .composer__hint, .session-error')) {
        const text = node.textContent;
        if (text && !window.sendTrace.errors.includes(text)) window.sendTrace.errors.push(text);
      }
      if (!document.querySelectorAll('.image-gallery--draft .image-thumbnail').length && window.sendTrace.message === null)
        window.sendTrace.message = performance.now() - window.sendTrace.start;
    });
    window.sendObserver.observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true});
  })()`);
  const checkSend = async () => {
    const trace = await evaluate('window.sendTrace');
    console.log('IMAGE_SEND_TRACE', JSON.stringify(trace));
    assert.deepEqual(trace.errors, [], 'successful image Send never flashes a failure');
  };
  try {
    await wait("!![...document.querySelectorAll('.session-list__item')].find(node => node.textContent.includes('Images test'))");
    await evaluate("[...document.querySelectorAll('.session-list__item')].find(node => node.textContent.includes('Images test')).click()");
    await wait("document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false");
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(${file('dropped.png')}); document.querySelector('form.composer').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer})); })()`);
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 1");
    await wait("document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false");
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(${file('pasted.png')}); document.querySelector('.composer__input').dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:transfer})); })()`);
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 2");
    await wait("document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false");
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(${file('picked.png')}); const input=document.querySelector('input[type=file]'); input.files=transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 3 && document.querySelector('.composer-actions__send')?.disabled === false");
    await uploaded(['dropped.png', 'pasted.png', 'picked.png']);
    assert.equal(await evaluate("document.querySelectorAll('.image-gallery--draft .image-upload, .image-gallery--draft [role=progressbar], .image-gallery--draft button[aria-label^=\"Retry upload\"]').length"), 0, 'draft thumbnails have no upload status overlays or retry controls');
    assert.equal(capture.requests.length, 3, 'each attachment starts one binary POST before Send');
    assert.equal(requests, 0, 'background image preparation does not submit inference');
    await wait("document.querySelector('.image-gallery--draft .image-thumbnail img')?.naturalWidth === 240");
    assert.equal(await evaluate("document.querySelector('.image-gallery--draft .image-thumbnail img').naturalHeight"), 240, 'composer uses a cached center-cropped thumbnail');
    const narrow = await evaluate("matchMedia('(max-width: 639px)').matches");
    assert.ok(Math.abs(await evaluate("document.querySelector('.image-thumbnail__remove').getBoundingClientRect().width") - (narrow ? 28 : 24)) < .1);
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      mkdirSync(process.env.FLAME_UI_CAPTURE_DIR, { recursive: true });
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'background-images-ready.png'), (await window.webContents.capturePage()).toPNG());
    }
    await reload();
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 3 && document.querySelector('.composer-actions__send')?.disabled === false");
    assert.equal(capture.requests.length, 3, 'reload restores prepared IDs without retransferring original bytes');
    await evaluate("document.querySelector('.image-thumbnail__open').focus(); document.querySelector('.image-thumbnail__open').click()");
    await wait("document.querySelector('dialog.image-viewer')?.open && document.querySelector('.image-zoom img')?.naturalWidth === 640");
    const closeStyle = await evaluate(`(() => { const close=document.querySelector('.image-viewer__close'), image=document.querySelector('.image-zoom'); const c=close.getBoundingClientRect(), i=image.getBoundingClientRect(), s=getComputedStyle(close), icon=close.querySelector('svg').getBoundingClientRect(); return {width:c.width,height:c.height,right:c.right-i.right,top:c.top-i.top,icon:icon.width,shadow:s.boxShadow}; })()`);
    assert.ok(Math.abs(closeStyle.width - (narrow ? 28 : 24)) < .1);
    assert.ok(Math.abs(closeStyle.height - (narrow ? 28 : 24)) < .1);
    assert.ok(Math.abs(closeStyle.icon - (narrow ? 16 : 14)) < .1);
    assert.ok(Math.abs(closeStyle.right) < 1); assert.ok(Math.abs(closeStyle.top + 40) < 1);
    assert.ok(!closeStyle.shadow.includes('102, 170, 255') && !closeStyle.shadow.includes('0px 0px 0px 3px'), 'close control has no extra focus highlighting');
    await click('.image-viewer__next'); await wait("document.querySelector('.image-viewer__caption')?.textContent.includes('pasted.png (2/3)')");
    await wait("document.querySelector('.image-zoom img')?.naturalWidth === 640 && parseFloat(document.querySelector('.image-zoom img').style.width) > 0");
    const fittedWidth = await evaluate("document.querySelector('.image-zoom img').getBoundingClientRect().width");
    await evaluate("document.querySelector('.image-zoom').focus(); document.querySelector('.image-zoom').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}))");
    await wait("document.querySelector('.image-zoom .image-sr-only')?.textContent === '200% zoom'");
    const zoomedWidth = await evaluate("document.querySelector('.image-zoom img').getBoundingClientRect().width");
    assert.ok(Math.abs(zoomedWidth - fittedWidth * 2) < .1, `Enter doubles the viewport-fitted image size: fit=${fittedWidth}, zoom=${zoomedWidth}`);
    await click('.image-viewer__close');
    assert.equal(await evaluate("document.activeElement?.classList.contains('image-thumbnail__open')"), true);
    const checkExistingPreview = await watchImagePreviewHandoff(evaluate, wait);
    await traceSend();
    await click('.composer-actions__send');
    await wait("document.querySelector('.session-history')?.textContent.includes('I can see all three images.') && document.querySelectorAll('.session-message--user .image-thumbnail').length === 3");
    assert.equal(requests, 1);
    assert.equal(capture.requests.length, 3, 'Send adopts ready IDs instead of posting images again');
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 0");
    await checkSend();
    await checkExistingPreview();
    await reload();
    await wait("document.querySelectorAll('.session-message--user .image-thumbnail').length === 3");
    assert.equal(requests, 1, 'renderer reload never sends the message again');
    await click('.session-message--user .image-thumbnail__open');
    await wait("document.querySelector('.image-zoom img')?.naturalWidth === 640");
    await evaluate("document.querySelector('dialog.image-viewer').dispatchEvent(new Event('cancel',{cancelable:true}))");
    assert.equal(await evaluate("!!document.querySelector('dialog.image-viewer')"), false);
    const entry = repository.use(location, db => db.history(null).entries.find(entry => entry.kind === 'user'));
    assert.equal(entry.text, ''); assert.equal(entry.images.length, 3);
    assert.ok(!JSON.stringify(entry).includes('base64,'));
    await checkBackgroundRetry({ evaluate, wait, click, add, capture });
    await checkUploadConcurrency({ evaluate, wait, click, add, capture });
    assert.equal(requests, 1, 'retrying and removing draft uploads does not submit a model turn');
    // A selected project remains a client-side draft until Send, including image-only drafts.
    await click('[aria-label="Filter threads by project"]');
    await wait("!!document.querySelector('.project-filter:popover-open')");
    const projectOption = `[...document.querySelectorAll('.project-filter [role=option]')].find(node => node.getAttribute('title') === ${JSON.stringify(work)})`;
    await wait(`!!(${projectOption})`);
    await evaluate(`(${projectOption}).click()`);
    await wait("document.querySelector('.session-empty__heading') !== null && document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false");
    await click('.composer-settings__model');
    await wait("!!document.querySelector('.model-picker:popover-open .model-picker__option')");
    await evaluate("[...document.querySelectorAll('.model-picker__option')].find(node => node.querySelector('.model-picker__name')?.textContent === 'Alpha').click()");
    await wait("document.querySelector('.composer-settings__label')?.textContent === 'Alpha'");
    capture.gate(['draft.png']);
    await evaluate(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000;
      const context = canvas.getContext('2d'), pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i] = seed >>> 24; pixels.data[i + 1] = seed >>> 16; pixels.data[i + 2] = seed >>> 8; pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), char => char.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'draft.png', {type:'image/png'}));
      document.querySelector('form.composer').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
    })()`);
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 1 && document.querySelector('.composer-actions__send')?.disabled === false");
    await wait(() => capture.held('draft.png'));
    assert.equal(repository.list().sessions.length, 1, 'attaching an image does not prematurely create a session');
    await evaluate("document.querySelector('.composer__input').focus()");
    await window.webContents.insertText('A large image');
    await click('.composer-actions__send');
    await wait("!!document.querySelector('.session-message--user[aria-busy=true] [aria-label=\"Preview draft.png\"]')");
    assert.equal(await evaluate("document.querySelector('.session-history').hidden"), false, 'a project draft appears in chat before a backend turn exists');
    assert.equal(await evaluate("document.querySelector('.composer__input').value"), '', 'text moves with the image');
    assert.equal(requests, 1, 'the provider has not received the held project send');
    await click('[aria-label="Stop sending"]');
    await wait("document.querySelector('[aria-label=\"Remove draft.png\"]')?.disabled === false");
    assert.equal(await evaluate("document.querySelector('.composer__input').value"), 'A large image', 'Stop restores the original text');
    assert.equal(await evaluate("document.querySelectorAll('.session-message--user[aria-busy=true]').length"), 0);
    capture.release('draft.png');
    await uploaded(['draft.png']);
    const draftTransfers = capture.requests.length;
    await reload();
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 1 && document.querySelector('.composer-actions__send')?.disabled === false");
    assert.equal(capture.requests.length, draftTransfers, 'project draft reload verifies ready staging without a new POST');
    const checkProjectPreview = await watchImagePreviewHandoff(evaluate, wait);
    await traceSend();
    await click('.composer-actions__send');
    await wait("document.querySelector('.session-history')?.textContent.includes('I can see all three images.') && document.querySelectorAll('.session-message--user .image-thumbnail').length === 1");
    assert.equal(requests, 2); assert.equal(repository.list().sessions.length, 2);
    assert.equal(await evaluate("document.querySelectorAll('.session-message--user').length"), 1, 'the acknowledged project message replaces the pending row without duplication');
    assert.equal(capture.requests.length, draftTransfers, 'image-only project Send reuses staged prepared bytes');
    await wait("document.querySelectorAll('.image-gallery--draft .image-thumbnail').length === 0");
    await wait("document.querySelector('[aria-label=\"Attach media\"]')?.disabled === false && !document.body.textContent.includes('Your image draft is still unsaved')");
    await checkSend();
    await checkProjectPreview();
    // Real Read tool -> private saved image -> model output -> disclosure/viewer/reload.
    window.focus(); window.webContents.focus();
    await evaluate("document.querySelector('.composer__input').focus()");
    await window.webContents.insertText('Read read-source.png');
    await wait("document.querySelector('.composer__input')?.value === 'Read read-source.png'");
    await wait("document.querySelector('.composer-actions__send')?.disabled === false"); await click('.composer-actions__send');
    await wait("document.querySelector('.session-history')?.textContent.includes('I read the image from disk.') && !![...document.querySelectorAll('.work-tool__command')].find(node => node.textContent === 'Read read-source.png')");
    assert.equal(requests, 4);
    const openRead = () => evaluate("[...document.querySelectorAll('.work-tool__command')].find(node => node.textContent === 'Read read-source.png').closest('button').click()");
    await openRead(); await wait("document.querySelector('.work-tool__detail .image-thumbnail img')?.naturalWidth === 640");
    await click('.work-tool__detail .image-thumbnail__open'); await wait("document.querySelector('.image-zoom img')?.naturalWidth === 640 && document.querySelector('.image-viewer__caption')?.textContent.includes('read-source.png')");
    await click('.image-viewer__close'); unlinkSync(join(work, 'read-source.png'));
    await reload(); await wait("!![...document.querySelectorAll('.work-tool__command')].find(node => node.textContent === 'Read read-source.png')");
    await openRead(); await click('.work-tool__detail .image-thumbnail__open');
    await wait("document.querySelector('.image-zoom img')?.naturalWidth === 640");
    assert.equal(requests, 4, 'saved image Read previews never rerun tools or inference after reload');
    await click('.image-viewer__close');
    console.log('FLAME_IMAGES_UI_OK');
  } finally { capture.close(); window.destroy(); abort.abort(); await server; projects.close(); app.quit(); }
}).catch(error => { console.error(error); app.exit(1); });
