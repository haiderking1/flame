import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export async function checkComposer({ evaluate, send }) {
  await send("Page.bringToFront");
  assert.deepEqual(await evaluate(`(() => {
    const composer = document.querySelector('.composer');
    const send = document.querySelector('button[type=submit]');
    return { heightWithinRounding: Math.abs(composer.getBoundingClientRect().height - 144) <= 1,
      padding: getComputedStyle(composer).paddingTop,
      radius: getComputedStyle(composer).borderRadius,
      sendSize: Math.round(send.getBoundingClientRect().height) };
  })()`), { heightWithinRounding: true, padding: "16px", radius: "24px", sendSize: 32 });
  assert.deepEqual(await evaluate(`(() => {
    const attach = document.querySelector('button[aria-label="Attach media"]');
    const send = document.querySelector('button[aria-label="Save message to session"]');
    const style = getComputedStyle(send);
    return { attachmentDisabled: attach.disabled, attachmentType: attach.type,
      round: style.borderRadius, square: style.width === style.height };
  })()`), { attachmentDisabled: false, attachmentType: "button", round: "50%", square: true });
  const value = () => evaluate("document.querySelector('.composer__input').value");
  const height = () => evaluate("document.querySelector('.composer__input').getBoundingClientRect().height");
  const replaceText = async (text) => {
    await evaluate("document.querySelector('.composer__input').focus(); getSelection().selectAllChildren(document.querySelector('.composer__input'))");
    await send("Input.insertText", { text });
    await delay(30);
  };
  const enter = async (modifiers = 0) => {
    await evaluate("document.querySelector('.composer__input').focus()");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers });
    await delay(30);
  };

  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled"), true);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Model settings"] button')).map(button => ({
    label: button.textContent.trim(), disabled: button.disabled, type: button.type
  }))`), [
    { label: "Select model", disabled: false, type: "button" },
    { label: "Thinking", disabled: true, type: "button" },
  ]);
  await replaceText("draft preserved");
  assert.equal(await value(), "draft preserved");
  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled"), false, "A session can save a local message without an agent");
  await enter();
  for (let i = 0; i < 100 && await value() !== ''; i++) await delay(20);
  assert.equal(await value(), '', 'Successful durable submission clears the draft');
  assert.equal(await evaluate("document.querySelector('.session-message p').textContent"), 'draft preserved');
  await replaceText('draft preserved');
  await enter(8); // Shift modifier.
  assert.equal(await value(), "draft preserved\n");

  const small = await height();
  await replaceText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  assert.ok(await height() > small, "Textarea did not grow");
  assert.ok(await height() <= 240, "Textarea exceeded its height limit");
  assert.equal(await evaluate("document.querySelector('.composer__input').scrollHeight > document.querySelector('.composer__input').clientHeight"), true);
  await replaceText("draft preserved");
  assert.ok(await height() <= small, "Textarea did not shrink");

  assert.equal(await evaluate(`(() => {
    const input = document.querySelector('.composer__input');
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    input.dispatchEvent(event);
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    return event.defaultPrevented;
  })()`), false, "IME confirmation must not be intercepted");
}
