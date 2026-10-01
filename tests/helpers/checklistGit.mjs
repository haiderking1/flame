import assert from 'node:assert/strict';
import { writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gitCommand } from '../../dist/backend/git/command.js';
import { captureUI } from './captureUI.mjs';

const primary = '.git-control__primary, .git-control__button--solo';
const toastTitle = "[...document.querySelectorAll('.toast[data-front] .toast__title strong')].map(node => node.textContent).join('|')";
async function pointer(driver, selector, type = 'move') {
  const point = await driver.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const zoom = driver.window.webContents.getZoomFactor(), position = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
  driver.window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
  if (type === 'click') { driver.window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position }); driver.window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position }); }
  await driver.settle();
}
async function openMenu(driver) {
  await driver.click('[aria-label="Git action options"]'); await driver.wait("document.querySelector('.git-actions-menu')?.matches(':popover-open')");
}
const closeMenu = driver => driver.evaluate("document.querySelector('.git-actions-menu')?.hidePopover(); true");
const menuItem = label => `[...document.querySelectorAll('.git-actions-menu [role=menuitem]')].find(item => item.textContent === ${JSON.stringify(label)})`;
// Finite animations (toast slide-in, dialog fade) have finished; spinners run forever and are ignored.
const still = driver => driver.wait("document.getAnimations().every(animation => animation.effect?.getComputedTiming().iterations === Infinity || animation.playState !== 'running')");
async function dismissToasts(driver) { await driver.evaluate("document.querySelectorAll('.toast__dismiss').forEach(button => button.click()); true"); await driver.wait("!document.querySelector('.toast')"); }

export async function checkGitUI(driver, project, otherProject, opened) {
  const { evaluate, wait, click, set } = driver;
  // Not a repository: a single "Initialize Git" button, which runs at once and reports in a toast.
  await wait("document.querySelector('.git-control__button--solo')?.textContent === 'Initialize Git'");
  await captureUI(driver, 'git-initialize');
  await click('.git-control__button--solo');
  await wait(`${toastTitle}.includes('Initialized repository')`);
  for (const [key, value] of [['user.name', 'Flame tests'], ['user.email', 'tests@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(project.path, ['config', key, value]);
  await gitCommand(project.path, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await wait("document.querySelector('.git-control__primary')?.getAttribute('aria-label') === 'Commit'");
  assert.ok(await evaluate("document.querySelector('[role=group][aria-label=\"Git actions\"]').querySelectorAll('.git-control__button').length === 2"), 'Git uses one action button and a separate options trigger');
  await dismissToasts(driver);

  // Without a remote, the menu offers Commit and publishing; the commit dialog lists files with their line counts.
  await openMenu(driver);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.git-actions-menu [role=menuitem]')].map(item => item.textContent)"), ['Commit', 'Publish repository...']);
  assert.ok(await evaluate("(() => {const m=document.querySelector('.git-actions-menu').getBoundingClientRect(),t=document.querySelector('[aria-label=\"Git action options\"]').getBoundingClientRect();return Math.abs(m.right-t.right)<2 && m.top>=t.bottom;})()"), 'the menu opens under the chevron, aligned to its right edge');
  await still(driver); await captureUI(driver, 'git-menu');
  await evaluate(`${menuItem('Commit')}.click(); true`);
  await wait("document.querySelector('.git-dialog')?.matches(':modal') && document.querySelector('.git-dialog h2').textContent === 'Commit changes'");
  assert.equal(await evaluate("document.querySelector('.git-commit__file')?.textContent"), 'base.ts+1 / -0');
  assert.ok(await evaluate("(() => {const r=document.querySelector('.git-dialog').getBoundingClientRect(); return Math.abs(r.left+r.width/2-innerWidth/2)<2 && r.top>=0 && r.bottom<=innerHeight;})()"), 'the dialog is centered and fits the viewport');
  await evaluate("[...document.querySelectorAll('.git-dialog button')].find(button => button.textContent === 'Edit').click(); true");
  await wait("document.querySelectorAll('.git-commit__file .git-checkbox').length === 1");
  await evaluate("document.querySelector('.git-commit__file .git-checkbox').click(); true");
  await wait("document.querySelector('.git-commit__file')?.textContent.includes('Excluded')");
  assert.equal(await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].filter(button => button.disabled).map(button => button.textContent).join('|')"), 'Commit on new branch|Commit', 'nothing selected means nothing to commit');
  await evaluate("document.querySelector('.git-commit__file .git-checkbox').click(); [...document.querySelectorAll('.git-dialog button')].find(button => button.textContent === 'Done').click(); true");
  await still(driver); await captureUI(driver, 'git-commit');
  await evaluate("document.querySelector('.git-commit__open').click(); true");
  for (let i = 0; i < 100 && !opened.length; i++) await delay(20);
  assert.deepEqual(opened, [join(await realpath(project.path), 'base.ts')], 'clicking a file opens it in the default application');
  await evaluate("(() => {const d=document.querySelector('.git-dialog'),r=d.getBoundingClientRect();d.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+5,clientY:r.top+5}));})()");
  assert.ok(await evaluate("document.querySelector('.git-dialog')?.matches(':modal')"), 'clicking dialog padding does not dismiss it');

  // An empty message is written by the selected model; progress and the result appear as toasts.
  await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].find(button => button.textContent === 'Commit').click(); true");
  await wait(`${toastTitle}.startsWith('Committed ')`);
  assert.equal((await gitCommand(project.path, ['log', '-1', '--format=%s'])).stdout.toString().trim(), 'Add base source');
  assert.equal(await evaluate("document.querySelector('.toast[data-front] .toast__action')"), null, 'without a remote there is nothing to push to');
  await still(driver); await captureUI(driver, 'git-toast-commit');
  await dismissToasts(driver);

  // No remote yet: the button offers t3code's publish wizard, which checks the hosting CLIs first.
  await wait("document.querySelector('.git-control__primary')?.getAttribute('aria-label') === 'Publish repository'");
  await click('.git-control__primary');
  await wait("document.querySelector('.git-dialog h2')?.textContent === 'Publish repository' && document.querySelectorAll('.git-publish__provider').length === 2");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.git-steps__label')].map(node => node.textContent)"), ['Provider', 'Repository', 'Summary']);
  assert.equal(await evaluate("[...document.querySelectorAll('.git-publish__provider')].filter(card => card.disabled).length"), 2, 'signed-out hosts need setup first');
  assert.match(await evaluate("document.querySelector('.git-publish__hint').textContent"), /not authenticated|not available/);
  assert.equal(await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].find(button => button.textContent === 'Next').disabled"), true);
  await still(driver); await captureUI(driver, 'git-publish');
  await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].find(button => button.textContent === 'Cancel').click(); true");
  await wait("!document.querySelector('.git-dialog')");

  // A clean, up-to-date branch: the button explains why it is disabled on hover.
  const remote = join(project.path, '..', 'Project-remote.git'); await mkdir(remote); await gitCommand(remote, ['init', '--bare', '--initial-branch=main']);
  await gitCommand(project.path, ['remote', 'add', 'origin', remote]);
  await evaluate("window.dispatchEvent(new Event('focus')); true");
  await wait("document.querySelector('.git-control__primary')?.getAttribute('aria-label') === 'Push'");
  assert.equal(await evaluate("document.querySelector('.git-control__primary').getAttribute('aria-disabled')"), null);

  // Pushing from the default branch asks first, offering a feature branch instead.
  await click('.git-control__primary');
  await wait("document.querySelector('.git-dialog h2')?.textContent === 'Push to default branch?'");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].map(button => button.textContent)"), ['Abort', 'Push to main', 'Check out feature branch & continue']);
  await still(driver); await captureUI(driver, 'git-default-branch');
  await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].find(button => button.textContent === 'Push to main').click(); true");
  await wait(`${toastTitle}.startsWith('Pushed ') && ${toastTitle}.includes('origin/main')`);
  assert.equal((await gitCommand(remote, ['rev-list', '--count', 'main'])).stdout.toString().trim(), '1');
  await dismissToasts(driver);
  await wait("document.querySelector('.git-control__primary')?.getAttribute('aria-disabled') === 'true'");
  await pointer(driver, '.git-control__primary');
  await wait("document.querySelector('.git-hint')?.matches(':popover-open')");
  assert.equal(await evaluate("document.querySelector('.git-hint').textContent"), 'Branch is up to date. No action needed.');
  await captureUI(driver, 'git-disabled-hint');
  await pointer(driver, '.workspace__composer');
  await openMenu(driver);
  assert.equal(await evaluate(`${menuItem('Push')}.getAttribute('aria-disabled')`), 'true');
  await pointer(driver, '.git-actions-menu > :nth-child(2) [role=menuitem]');
  await wait("[...document.querySelectorAll('.git-actions-menu .git-hint')].some(hint => hint.matches(':popover-open') && hint.textContent === 'No local commits to push.')");
  await closeMenu(driver); await pointer(driver, '.workspace__composer');

  // A slow hook shows its name in the progress toast; switching projects cannot retarget the running action.
  await writeFile(join(project.path, 'switch.txt'), 'Project-owned operation');
  await writeFile(join(project.path, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho linting staged files\nsleep 1\n', { mode: 0o755 });
  await wait("document.querySelector('.git-control__primary')?.getAttribute('aria-label') === 'Commit & push'");
  await openMenu(driver); await evaluate(`${menuItem('Commit')}.click(); true`);
  await wait("document.querySelector('.git-dialog h2')?.textContent === 'Commit changes'");
  await set('.git-dialog textarea', 'Keep action tied to project');
  await evaluate("[...document.querySelectorAll('.git-dialog__footer button')].find(button => button.textContent === 'Commit').click(); true");
  await wait(`${toastTitle} === 'Running pre-commit...'`);
  await wait("document.querySelector('.toast[data-front] .toast__description')?.textContent === 'linting staged files'");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Git action options\"]').disabled"), true, 'options are locked while an action runs');
  await still(driver); await captureUI(driver, 'git-toast-progress');
  await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
  await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(otherProject.path)}).click()`);
  await wait("document.querySelector('.workspace__composer').dataset.empty === 'true'");
  assert.equal(await evaluate("document.querySelectorAll('.toast').length"), 0, 'toasts belong to their project');
  for (let attempt = 0; attempt < 200; attempt++) { if ((await gitCommand(project.path, ['rev-list', '--count', 'HEAD'])).stdout.toString().trim() === '2') break; await delay(20); }
  assert.equal((await gitCommand(project.path, ['rev-list', '--count', 'HEAD'])).stdout.toString().trim(), '2');
  assert.equal((await gitCommand(project.path, ['log', '-1', '--format=%s'])).stdout.toString().trim(), 'Keep action tied to project');
  assert.equal((await gitCommand(otherProject.path, ['rev-parse', '--show-toplevel'], { allowed: [0, 128] })).code, 128, 'project switches never retarget submitted mutations');
  await rm(join(project.path, '.git', 'hooks', 'pre-commit'));
  await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
  await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
  await wait(`${toastTitle}.startsWith('Committed ')`);
  await dismissToasts(driver);
}
