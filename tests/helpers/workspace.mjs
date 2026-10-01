import assert from "node:assert/strict";

export async function checkWorkspace(evaluate) {
  assert.ok(await evaluate(`(() => {
    const sidebar = document.querySelector('aside[aria-label="Sidebar"]');
    const bounds = sidebar.getBoundingClientRect();
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    return sidebar.querySelector('[role="separator"]') !== null && bounds.left === 0 && bounds.top === 0 &&
      bounds.width >= 207 && bounds.width <= Math.max(208, Math.floor(innerWidth) - 640) + 1 && bounds.height >= innerHeight - 1 &&
      Math.abs(bounds.right - workspace.left) < 1 && document.documentElement.scrollWidth <= innerWidth + 1;
  })()`), 'Sidebar layout must fit the viewport');
  const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.deepEqual(await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('nav[aria-label="Workspace actions"] button')];
    return { labels: buttons.map(b => b.getAttribute('aria-label')), gitDisabled: buttons[0].disabled,
      open: buttons[2].getAttribute('aria-expanded'), hidden: !document.querySelector('#workspace-diff') };
  })()`), { labels: ["Commit", "Git action options", "Toggle diff panel"], gitDisabled: true, open: "false", hidden: true });
  const toggle = "document.querySelector('[aria-controls=workspace-diff]')";
  const originalWidth = await evaluate("document.querySelector('.workspace__chat').getBoundingClientRect().width");
  await evaluate(`${toggle}.click()`);
  for (let i = 0; i < 150 && !await evaluate("!!document.querySelector('#workspace-diff')"); i++) await new Promise(resolve => setTimeout(resolve, 20));
  await settle();
  assert.equal(await evaluate(`${toggle}.getAttribute('aria-expanded')`), "true");
  assert.ok(await evaluate("!!document.querySelector('#workspace-diff')"));
  assert.ok(await evaluate(`(() => {
    const chat = document.querySelector('.workspace__chat').getBoundingClientRect();
    const panel = document.querySelector('#workspace-diff').getBoundingClientRect();
    return Math.abs(panel.right - innerWidth) < 1 && panel.width > 0 && (innerWidth <= 700 || chat.width < ${originalWidth});
  })()`), 'Diff panel must align right and leave space for chat');
  await evaluate("document.querySelector('[aria-label=\"Close diff panel\"]').click()");
  await settle();
  assert.equal(await evaluate(`document.activeElement === ${toggle}`), true);
  assert.equal(await evaluate(`getComputedStyle(${toggle}).outlineStyle`), 'none');
  assert.equal(await evaluate("!document.querySelector('#workspace-diff')"), true);
  await evaluate(`${toggle}.click()`); await settle();
  await evaluate(`${toggle}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await settle();
  assert.equal(await evaluate("!document.querySelector('#workspace-diff')"), true);
  await evaluate(`${toggle}.click()`); await settle(); await evaluate(`${toggle}.click()`); await settle();
  assert.equal(await evaluate("!document.querySelector('#workspace-diff')"), true);
}
