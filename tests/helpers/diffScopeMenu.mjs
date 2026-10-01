import assert from 'node:assert/strict';
import { captureUI } from './captureUI.mjs';

export async function checkDiffScopeMenu(driver) {
  const { evaluate, wait, click, settle }=driver;
  const trigger='.diff-scope-trigger';
  assert.equal(await evaluate("document.querySelector('.diff-view__toolbar select')"),null,'scope uses a styled menu, not a platform select');
  async function pointer(selector) {
    const point=await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`),zoom=driver.window.webContents.getZoomFactor();
    const position={x:Math.round(point.x*zoom),y:Math.round(point.y*zoom)};
    driver.window.webContents.sendInputEvent({type:'mouseMove',...position});
    driver.window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...position});
    driver.window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...position});
    await settle();
  }
  await pointer(trigger); await wait("document.querySelector('.diff-scope-menu').matches(':popover-open')"); await settle();
  assert.ok(await evaluate("(() => {const m=document.querySelector('.diff-scope-menu'),t=document.querySelector('.diff-scope-trigger'),r=m.getBoundingClientRect(),a=t.getBoundingClientRect();return getComputedStyle(m).backgroundColor==='rgba(22, 22, 22, 0.92)' && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight && Math.abs(r.left-a.left)<2 && r.top>=a.bottom;})()"),'dark menu is anchored to the trigger and fits the viewport');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.diff-scope-trigger')).outlineStyle"),'none','trigger has no bright browser outline');
  assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"),'none','menu focus uses the styled row highlight');
  await captureUI(driver,'diff-scope-menu');
  await pointer(trigger);await wait("!document.querySelector('.diff-scope-menu').matches(':popover-open')");
  await pointer(trigger);await wait("document.querySelector('.diff-scope-menu').matches(':popover-open')");
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true");
  assert.equal(await evaluate('document.activeElement.textContent'),'Staged changes');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true");
  await wait("!document.querySelector('.diff-scope-menu').matches(':popover-open')");
  assert.ok(await evaluate("document.activeElement.matches('.diff-scope-trigger') && !!document.querySelector('#workspace-diff')"),'Escape returns focus without closing the diff panel');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));true");
  await wait("document.querySelector('.diff-scope-menu').matches(':popover-open')");
  assert.equal(await evaluate('document.activeElement.textContent'),'Staged changes');
  await evaluate('document.activeElement.click();true');await wait("document.querySelector('.diff-scope-trigger').textContent==='Staged changes'");
  assert.ok(await evaluate("document.activeElement.matches('.diff-scope-trigger')"));
  await click(trigger);await wait("document.querySelector('.diff-scope-menu').matches(':popover-open')");
  assert.equal(await evaluate("document.querySelector('.diff-scope-menu [aria-checked=true]').textContent"),'Staged changes');
  await evaluate("[...document.querySelectorAll('.diff-scope-menu button')].find(button=>button.textContent==='Working tree').click();true");
  await wait("document.querySelector('.diff-scope-trigger').textContent==='Working tree'");
  await pointer(trigger);await wait("document.querySelector('.diff-scope-menu').matches(':popover-open')");
  await pointer('[aria-label="Collapse all files"]');await wait("!document.querySelector('.diff-scope-menu').matches(':popover-open')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'Collapse all files','outside dismissal preserves the clicked focus target');
}
