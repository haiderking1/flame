import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
export function rendererDriver(window) {
  const evaluate = expression => window.webContents.executeJavaScript(expression, true).catch(error => { throw new Error(`${error.message}\nExpression: ${expression.slice(0, 1000)}`, { cause: error }); });
  const wait = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await delay(20); }
    assert.fail(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`);
  };
  const click = async selector => { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const set = async (selector, value) => {
    await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element || element.disabled || element.readOnly) throw new Error('Input is not editable'); element.focus(); if(element.isContentEditable) getSelection().selectAllChildren(element); else element.select(); const started=performance.now(); window.__nextInputFrame=new Promise(resolve=>element.addEventListener('input',()=>{ const eventTime=performance.now(); requestAnimationFrame(()=>{ const frame=performance.now(); (window.__inputPhases ??= []).push({selector:${JSON.stringify(selector)},dispatchMs:eventTime-started,frameMs:frame-eventTime}); resolve(frame-started); }); },{once:true})); })()`);
    if(value) await window.webContents.debugger.sendCommand('Input.insertText',{text:value});
    else { await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8}); await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8}); }
    return evaluate('window.__nextInputFrame');
  };
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return { window, evaluate, wait, click, set, settle };
}
