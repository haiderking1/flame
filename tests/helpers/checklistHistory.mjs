import assert from 'node:assert/strict';
import { captureUI } from './captureUI.mjs';
import { setTimeout as delay } from 'node:timers/promises';
export async function checkHistory(driver, sessionId, measurements) {
  const { evaluate, wait, click, set, settle } = driver;
  await click(`.session-list__item[id$="-${sessionId}"]`);
  await wait("!!document.querySelector('.session-history__older')");
  for (let page = 0; page < 6; page++) {
    await wait("!document.querySelector('.session-history__older').disabled");
    let transition;
    if (page === 1) {
      assert.equal(await evaluate("!!document.querySelector('[data-history-window]')"), false);
      await evaluate("document.querySelector('.session-history').scrollTop = document.querySelector('.session-history').scrollHeight / 2; true"); await settle();
      transition = await evaluate(`(() => { const history=document.querySelector('.session-history'), top=history.getBoundingClientRect().top; const row=[...history.querySelectorAll('[data-history-entry]')].find(node=>node.getBoundingClientRect().top >= top); return {id:row.dataset.historyEntry,offset:row.getBoundingClientRect().top-top}; })()`);
    }
    await click('.session-history__older'); await delay(70);
    if (transition) {
      await delay(200); await settle();
      const offset = await evaluate(`document.querySelector('[data-history-entry="${transition.id}"]')?.getBoundingClientRect().top - document.querySelector('.session-history').getBoundingClientRect().top`);
      assert.ok(Math.abs(offset - transition.offset) < 8, `flow-to-window prepend preserves anchor: ${transition.offset} -> ${offset}`);
    }
  }
  await wait("!!document.querySelector('.session-history [data-virtual-list=true]')"); await settle();
  measurements.chatNodes = await evaluate("document.querySelector('.session-history').querySelectorAll('*').length");
  assert.ok(measurements.chatNodes < 1500, `history DOM is bounded: ${measurements.chatNodes}`);
  measurements.scrollFrameMs = [];
  for (const fraction of [.2,.5,.9,.4]) measurements.scrollFrameMs.push(await evaluate(`(() => { const started=performance.now(), element=document.querySelector('.session-history'); element.scrollTop=element.scrollHeight*${fraction}; return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-started)))); })()`));
  await evaluate("(() => { const history = document.querySelector('.session-history'); history.scrollTop = history.scrollHeight / 2; })()"); await settle();
  const anchor = await evaluate(`(() => { const history = document.querySelector('.session-history'), top = history.getBoundingClientRect().top; const row = [...history.querySelectorAll('.session-message')].find(row => row.getBoundingClientRect().top >= top); return { text: row.textContent, offset: row.getBoundingClientRect().top - top }; })()`);
  await click('.session-history__older'); await delay(200); await settle();
  const restored = await evaluate(`(() => { const history = document.querySelector('.session-history'), row = [...history.querySelectorAll('.session-message')].find(row => row.textContent === ${JSON.stringify(anchor.text)}); return row ? row.getBoundingClientRect().top - history.getBoundingClientRect().top : null; })()`);
  assert.ok(restored !== null && Math.abs(restored - anchor.offset) < 8, `prepend preserves anchor (${anchor.offset} -> ${restored})`);
  await evaluate("document.querySelector('.session-history').scrollTop = document.querySelector('.session-history').scrollHeight; true"); await settle();
  await evaluate("if (window.__flamePerformance) window.__flamePerformance = {rowRenders:{},commits:[],renders:[]}; true");
  const start = await evaluate('performance.now()'); await set('textarea', 'Benchmark response'); await click('[aria-label="Send message"]');
  await wait("document.querySelector('.session-history').textContent.includes('Paragraph 0')");
  measurements.sendToFirstOutputMs = await evaluate(`performance.now() - ${start}`);
  await evaluate(`(() => { window.__liveParagraph=[...document.querySelectorAll('.session-message p')].find(node=>node.textContent.startsWith('Paragraph 0')); const range=document.createRange(); range.selectNodeContents(window.__liveParagraph); getSelection().removeAllRanges(); getSelection().addRange(range); window.__liveSelectedText=getSelection().toString(); })()`);
  await evaluate("(() => { const history = document.querySelector('.session-history'); history.scrollTop = history.scrollHeight / 2; })()"); await settle();
  await delay(100); await settle();
  const reading = await evaluate(`(() => { const box=document.querySelector('.session-history').getBoundingClientRect(); const row=[...document.querySelectorAll('[data-history-entry]')].find(node=>node.getBoundingClientRect().bottom>box.top); return {id:row.dataset.historyEntry,offset:row.getBoundingClientRect().top-box.top}; })()`);
  await wait("!document.querySelector('[aria-label=\"Stop response\"]') && document.querySelector('.workspace__composer').dataset.saveState === 'saved'"); await settle();
  assert.ok(await evaluate('window.__liveParagraph.isConnected && getSelection().toString() === window.__liveSelectedText'), 'the streamed message keeps its row and selection through durable completion');
  await evaluate('getSelection().removeAllRanges(); delete window.__liveParagraph; true');
  const readingAfter = await evaluate(`(() => { const box=document.querySelector('.session-history').getBoundingClientRect(); const row=document.querySelector('[data-history-entry="${reading.id}"]'); return row ? row.getBoundingClientRect().top-box.top : null; })()`);
  measurements.historyAnchorDriftPx = readingAfter === null ? null : readingAfter - reading.offset;
  assert.ok(readingAfter !== null && Math.abs(readingAfter - reading.offset) < 8, `streaming preserves the visible message anchor: ${reading.offset} -> ${readingAfter}`);
  assert.ok(await evaluate("!!document.querySelector('.session-history [data-virtual-list=true]')"), 'turn completion keeps previously loaded history');
  await evaluate("document.querySelector('.session-history').scrollTop=document.querySelector('.session-history').scrollHeight; true");
  await wait("!!document.querySelector('.markdown-code__line') && document.querySelector('.markdown-code code')?.textContent.includes('sample127')");
  assert.equal(await evaluate("document.querySelector('.markdown-code__language[aria-label=\"Language: rust\"] .file-icon')?.dataset.fileIcon"), 'rust', 'code blocks show the language icon, named for assistive tech');
  if (process.env.FLAME_SCREENSHOT_DIR) {
    await evaluate("document.querySelector('.markdown-code__header').scrollIntoView({ block: 'center' }); true");
    await captureUI(driver, 'chat-code-language');
    await evaluate("document.querySelector('.session-history').scrollTop=document.querySelector('.session-history').scrollHeight; true");
  }
  assert.ok(await evaluate("window.__workerTimings.some(task=>task.type==='chat')"), 'completed chat code is genuinely highlighted in a worker under production CSP');
  measurements.chatCodeNodes = await evaluate("document.querySelector('.session-history').querySelectorAll('*').length");
  assert.ok(measurements.chatCodeNodes < 1500);
  const trace = await evaluate('window.__flamePerformance ?? null');
  if (trace) {
    measurements.reactCommitMs = trace.commits; measurements.reactRenderMs = trace.renders; measurements.rowRenders = trace.rowRenders;
    assert.ok(Object.values(trace.rowRenders).filter(count => count > 1).length < 20, 'streaming updates only changed rows and newly exposed viewport rows');
  }
  // A selected row remains mounted across a scroll out of the viewport.
  await evaluate(`(() => { const row = document.querySelector('.session-message p'); const selection = getSelection(), range = document.createRange(); range.selectNodeContents(row); selection.removeAllRanges(); selection.addRange(range); window.__selectedText = selection.toString(); })()`);
  await delay(30); await evaluate("document.querySelector('.session-history').scrollTop = 0; true"); await settle();
  assert.equal(await evaluate('getSelection().toString()'), await evaluate('window.__selectedText'), 'virtualization retains selection anchors');
  await evaluate('getSelection().removeAllRanges(); true');
}
