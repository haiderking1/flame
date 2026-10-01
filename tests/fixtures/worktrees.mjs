import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { CodexInferenceClient } from '../../dist/backend/turns/client.js';
import { gitCommand } from '../../dist/backend/git/command.js';
import { rendererDriver } from '../helpers/rendererDriver.mjs';
import { isTitleRequest, titleReply } from '../helpers/titleModel.mjs';
import { captureUI } from '../helpers/captureUI.mjs';
import { installFakeGitHub } from '../helpers/fakeHosting.mjs';

const git = async (cwd, args) => (await gitCommand(cwd, args)).stdout.toString('utf8').trim();
const reply = text => new Response([{ type: 'response.output_item.done', output_index: 0, item: { id: 'm', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
  { type: 'response.completed', response: { status: 'completed', output: [] } }].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const home = app.getPath('home'), userData = app.getPath('userData');
  const filename = join(userData, 'flame.sqlite'), projects = new ProjectStore(filename);
  const projectPath = join(userData, 'Project'); await mkdir(projectPath);
  await gitCommand(projectPath, ['init', '--initial-branch=main']);
  for (const [key, value] of [['user.name', 'Flame tests'], ['user.email', 'tests@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(projectPath, ['config', key, value]);
  await writeFile(join(projectPath, 'README.md'), '# Project\n'); await gitCommand(projectPath, ['add', '.']); await gitCommand(projectPath, ['commit', '-m', 'Initial commit']);
  await gitCommand(projectPath, ['branch', 'feature/existing']);
  const project = projects.add(projectPath);
  const model = { slug: 'test-model', display_name: 'Test model', priority: 0, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }] };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [model] }));
  const gh = await installFakeGitHub();
  const cwds = [];
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (isTitleRequest(body)) return titleReply();
    if (/git commit messages/.test(body.instructions)) return reply(JSON.stringify(/git branch names/.test(JSON.stringify(body.input)) ? { branch: 'Fix login redirect' } : { subject: 'Change', body: '' }));
    cwds.push(/<cwd>\n(.*)\n<\/cwd>/.exec(body.instructions)?.[1]);
    return reply('Done in the worktree.');
  });
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename, token: 'worktree-token', origin: 'file://', openBrowser: async () => assert.fail('No sign-in in tests'), modelsClient, inferenceClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=worktree-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait, click, set } = driver;
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const label = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-label') ?? null`);
  const workspaceTrigger = '.branch-toolbar [aria-label^="Workspace:"]', branchTrigger = '.branch-toolbar [aria-label^="Branch:"]';
  const menuItem = text => `[...document.querySelectorAll('.branch-menu:popover-open .branch-menu__item')].find(item => item.textContent.startsWith(${JSON.stringify(text)}))`;
  const worktreesRoot = join(home, '.flame', 'worktrees', 'Project');
  try {
    await wait("!!document.querySelector('.project-filter__option') || !!document.querySelector('[aria-label^=\"Filter threads by project\"]')");
    if (await evaluate("document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === 'false'")) await click('.sidebar-toggle');
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait(`document.querySelector('.composer__input').readOnly === false && !!document.querySelector(${JSON.stringify(branchTrigger)})`);
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: main'`);
    assert.equal(await label(workspaceTrigger), 'Workspace: Current checkout');
    await click('.composer .composer-settings__model'); await wait("!!document.querySelector('.model-picker:popover-open .model-picker__option')");
    await evaluate("document.querySelector('.model-picker:popover-open .model-picker__option').click()");
    await wait("document.querySelector('.composer .composer-settings__model').getAttribute('aria-label') === 'Select model: Test model'");
    await captureUI(driver, 'worktree-toolbar-local');

    // A menu used with the mouse leaves its trigger unlit, though focus goes back to it; Escape from the keyboard keeps the focus ring.
    const input = (method, params) => window.webContents.debugger.sendCommand(method, params);
    const mouse = async expression => {
      const { x, y } = await evaluate(`(() => { const box = (${expression}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await input('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    };
    const trigger = "document.querySelector('.composer .composer-settings__model')", option = "document.querySelector('.model-picker:popover-open .model-picker__option')";
    await mouse(trigger); await wait(`!!${option} && document.activeElement?.matches('.model-picker input')`);
    await input('Input.insertText', { text: 'Test' }); await wait(`!!${option}`);
    await mouse(option);
    await wait(`!document.querySelector('.model-picker:popover-open') && document.activeElement === ${trigger}`);
    await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 500 });
    assert.equal(await evaluate(`${trigger}.matches(':focus-visible')`), false, 'a model picked with the mouse leaves no focus ring');
    assert.equal(await evaluate(`getComputedStyle(${trigger}).backgroundColor`), 'rgba(0, 0, 0, 0)', 'nor a highlight');
    await mouse(trigger); await wait(`!!document.querySelector('.model-picker:popover-open') && document.activeElement?.matches('.model-picker input')`);
    await input('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await input('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(`!document.querySelector('.model-picker:popover-open') && document.activeElement === ${trigger}`);
    assert.equal(await evaluate(`${trigger}.matches(':focus-visible')`), true, 'Escape from the keyboard keeps the focus ring');
    await evaluate(`${trigger}.blur()`);

    // Choose a new worktree for the draft; its base defaults to the branch checked out, from origin as Settings default.
    await click(workspaceTrigger); await wait(`!!(${menuItem('New worktree')})`);
    await captureUI(driver, 'worktree-workspace-menu');
    await evaluate(`${menuItem('New worktree')}.click()`);
    await wait(`document.querySelector(${JSON.stringify(workspaceTrigger)}).getAttribute('aria-label') === 'Workspace: New worktree'`);
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: From origin/main'`);
    await click(branchTrigger); await wait("!!document.querySelector('.branch-picker:popover-open [aria-label=\"Start worktree from origin\"]')");
    await wait(`!!(${menuItem('feature/existing')})`);
    assert.equal(await evaluate("[...document.querySelectorAll('.branch-picker:popover-open .branch-menu__item')].some(item => item.textContent.startsWith('Create new ref'))"), false, 'a base is picked, not created');
    await captureUI(driver, 'worktree-base-picker');
    await evaluate("document.querySelector('.branch-picker:popover-open [aria-label=\"Start worktree from origin\"]').click()");
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: From main'`);
    await evaluate("document.querySelector('.branch-picker:popover-open')?.hidePopover()");

    // The first message creates the worktree; the agent works there and the branch is named from the message.
    await set('.composer__input', 'Fix the login redirect');
    await evaluate("document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await wait("!!document.querySelector('.session-list__worktree')");
    await wait("document.querySelector('.session-list__worktree')?.textContent === 'flame/fix-login-redirect'");
    await wait("[...document.querySelectorAll('.session-history .assistant-content, .session-history p')].some(node => node.textContent.includes('Done in the worktree.'))");
    const [worktree] = (await git(projectPath, ['worktree', 'list', '--porcelain'])).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9)).slice(1);
    assert.ok(worktree?.startsWith(worktreesRoot), `${worktree} is under ${worktreesRoot}`);
    assert.equal(cwds.at(-1), worktree, 'the agent worked in the worktree');
    await wait(`document.querySelector('.branch-toolbar__static')?.textContent === 'Worktree'`);
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: flame/fix-login-redirect'`);
    assert.equal(await evaluate("!!document.querySelector('.worktree-setup')"), false, 'a clean setup leaves no card once the agent starts');
    await captureUI(driver, 'worktree-session');

    // Ctrl+Shift+G opens the branch picker; a typed name that does not exist can be created in the worktree.
    const shortcut = code => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
    await shortcut('KeyG'); await wait("!!document.querySelector('.branch-picker:popover-open')");
    await set('.branch-picker:popover-open input', 'feature/ui-made');
    await wait(`!!(${menuItem('Create new ref "feature/ui-made"')})`);
    await evaluate(`${menuItem('Create new ref "feature/ui-made"')}.click()`);
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: feature/ui-made'`);
    assert.equal(await git(worktree, ['branch', '--show-current']), 'feature/ui-made');
    await wait("document.querySelector('.session-list__worktree')?.textContent === 'feature/ui-made'");

    // "New thread on <branch>" starts a session in the same worktree, which can still change where it works.
    await wait("document.querySelector('[aria-label=\"Options for Fix the login redirect\"]')?.disabled === false");
    await click('[aria-label="Options for Fix the login redirect"]'); await wait("!!document.querySelector('.session-menu')");
    await evaluate("[...document.querySelectorAll('.session-menu button')].find(button => button.textContent === 'New thread on feature/ui-made').click()");
    await wait(`document.querySelector(${JSON.stringify(workspaceTrigger)})?.getAttribute('aria-label') === 'Workspace: Current worktree'`);
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: feature/ui-made'`);
    assert.equal(await evaluate("document.querySelectorAll('.session-list__worktree').length"), 2, 'both sessions show the shared worktree');

    // Settings: a failing setup script shows on the next worktree's setup card.
    await click('.sidebar-footer [aria-label="Settings"]'); await wait("!!document.querySelector('.settings-navigation')");
    await evaluate("[...document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === 'Worktrees').click()");
    await wait("!!document.querySelector('.worktree-settings textarea')");
    await set('.worktree-settings textarea', 'echo preparing; exit 3');
    await evaluate("[...document.querySelectorAll('.worktree-settings__script-actions button')].find(button => button.textContent === 'Save').click()");
    await wait("!!document.querySelector('.worktree-settings__script-actions')?.textContent.includes('Remove')");
    await captureUI(driver, 'worktree-settings');
    await click('[aria-label="Close settings"]'); await wait("!document.querySelector('.settings-page')");
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait(`document.querySelector('.composer__input').readOnly === false && document.querySelector(${JSON.stringify(workspaceTrigger)})?.getAttribute('aria-label') === 'Workspace: Current checkout'`);
    await click(workspaceTrigger); await wait(`!!(${menuItem('Previous worktree')})`);
    await evaluate(`${menuItem('New worktree')}.click()`);
    await wait(`document.querySelector(${JSON.stringify(workspaceTrigger)}).getAttribute('aria-label') === 'Workspace: New worktree'`);
    await set('.composer__input', 'Add a settings page');
    await evaluate("document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await wait("document.querySelector('.worktree-setup h3')?.textContent === 'Worktree ready, setup script failed'");
    await click('.worktree-setup__actions button'); await wait("document.querySelector('.worktree-setup__output')?.textContent.includes('preparing')");
    await captureUI(driver, 'worktree-setup-card');

    // Edit from here in a worktree thread can put its files back as they were before the message.
    const second = (await git(projectPath, ['worktree', 'list', '--porcelain'])).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9)).find(path => path !== projectPath && path !== worktree);
    await writeFile(join(second, 'made-by-agent.txt'), 'later\n');
    await wait("!document.querySelector('.composer [aria-label=\"Stop response\"]') && document.querySelector('[aria-label=\"Edit from here\"]')?.disabled === false");
    // The button is briefly disabled while the thread reloads after its response; click until the dialog opens.
    await wait("(() => { if (!document.querySelector('.edit-from-here')) document.querySelector('[aria-label=\"Edit from here\"]')?.click(); return !!document.querySelector('.edit-from-here'); })()");
    await wait("[...document.querySelectorAll('.edit-from-here button')].some(button => button.textContent === 'Revert files too')");
    assert.equal(await evaluate("document.querySelector('.edit-from-here .git-dialog__description').textContent"), 'Rewind chat to before this message. Your prompt and attachments return to the composer.');
    await evaluate("[...document.querySelectorAll('.edit-from-here button')].find(button => button.textContent === 'Revert files too').click()");
    await wait("!document.querySelector('.edit-from-here') && document.querySelector('.composer__input').value === 'Add a settings page'");
    assert.equal(existsSync(join(second, 'made-by-agent.txt')), false, 'files made after the message are gone');
    assert.ok(existsSync(join(second, 'README.md')));

    // A session sharing the worktree is deleted without touching it.
    await wait("document.querySelector('[aria-label=\"Options for New session\"]')?.disabled === false");
    await click('[aria-label="Options for New session"]'); await wait("!!document.querySelector('.session-menu')");
    await evaluate("[...document.querySelectorAll('.session-menu button')].find(button => button.textContent === 'Delete').click()");
    await wait("document.querySelector('.session-dialog h2')?.textContent === 'Delete thread?'");
    await evaluate("document.querySelector('.session-dialog button[type=submit]').click()");
    await wait("!document.querySelector('.session-dialog') && !document.querySelector('[aria-label=\"Options for New session\"]')");
    assert.ok(existsSync(worktree), 'a worktree another session uses is never offered for deletion');

    // Delete the first session: it is the only one in its worktree, so Flame offers to delete the worktree too.
    await wait("document.querySelector('[aria-label=\"Options for Fix the login redirect\"]')?.disabled === false");
    await click('[aria-label="Options for Fix the login redirect"]'); await wait("!!document.querySelector('.session-menu')");
    await evaluate("[...document.querySelectorAll('.session-menu button')].find(button => button.textContent === 'Delete').click()");
    await wait("document.querySelector('.session-dialog h2')?.textContent === 'Delete thread?'");
    await evaluate("document.querySelector('.session-dialog button[type=submit]').click()");
    await wait("document.querySelector('.session-dialog h2')?.textContent === 'Delete worktree too?'");
    await captureUI(driver, 'worktree-delete-prompt');
    await evaluate("document.querySelector('.session-dialog button[type=submit]').click()");
    await wait("!document.querySelector('.session-dialog')");
    for (let i = 0; i < 200 && existsSync(worktree); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(existsSync(worktree), false, 'the worktree folder was removed');
    assert.equal(await git(projectPath, ['branch', '--list', 'flame/fix-login-redirect']), 'flame/fix-login-redirect', 'its branch is kept');

    // A pull request typed into the branch picker checks out into its own worktree, in a new session.
    const bare = join(userData, 'remote.git'); await mkdir(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
    const url = 'https://github.com/acme/app.git';
    await gitCommand(projectPath, ['remote', 'add', 'origin', url]); await gitCommand(projectPath, ['config', `url.${bare}.insteadOf`, url]);
    await gitCommand(projectPath, ['push', '-q', 'origin', 'main', 'feature/existing:refs/heads/feature/login', 'feature/existing:refs/pull/7/head']);
    await gh.setPrs([{ number: 7, title: 'Fix the login page', url: 'https://github.com/acme/app/pull/7', baseRefName: 'main', headRefName: 'feature/login', state: 'OPEN', isCrossRepository: false, headRepositoryOwner: { login: 'acme' } }]);
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait(`document.querySelector('.composer__input').readOnly === false && !!document.querySelector(${JSON.stringify(branchTrigger)})`);
    await wait("[...document.querySelectorAll('.git-control__label')].some(label => label.textContent !== 'Publish repository')");
    await click(branchTrigger); await wait("!!document.querySelector('.branch-picker:popover-open')");
    await set('.branch-picker:popover-open input', '#7');
    await wait(`!!(${menuItem('Checkout pull request')})`);
    await evaluate(`${menuItem('Checkout pull request')}.click()`);
    await wait("document.querySelector('.pull-request-dialog__title')?.textContent === 'Fix the login page'");
    await captureUI(driver, 'worktree-pull-request');
    await evaluate("[...document.querySelectorAll('.pull-request-dialog button')].find(button => button.textContent === 'Worktree').click()");
    await wait("!document.querySelector('.pull-request-dialog')");
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)})?.getAttribute('aria-label') === 'Branch: feature/login'`);
    assert.equal(await label(workspaceTrigger), 'Workspace: Current worktree');
    assert.ok((await git(projectPath, ['worktree', 'list'])).includes('[feature/login]'), 'the pull request has its own worktree');

    // A thread in the project checkout notices when the checkout moved to another branch, and can switch it back.
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait(`document.querySelector('.composer__input').readOnly === false && document.querySelector(${JSON.stringify(workspaceTrigger)})?.getAttribute('aria-label') === 'Workspace: Current checkout'`);
    await set('.composer__input', 'Work in the checkout');
    await evaluate("document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await wait("!!document.querySelector('[aria-label=\"Options for Work in the checkout\"]') && document.querySelector('.composer__input').readOnly === false && !document.querySelector('.composer [aria-label=\"Stop response\"]')");
    await gitCommand(projectPath, ['switch', '-q', '-c', 'elsewhere']);
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await wait("!!document.querySelector('.session-list__mismatch')");
    assert.equal(await evaluate("!!document.querySelector('.branch-mismatch')"), false, 'the notice waits until the user writes');
    await set('.composer__input', 'Next step');
    await wait("document.querySelector('.branch-mismatch code')?.textContent === 'main'");
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: elsewhere'`);
    await captureUI(driver, 'worktree-branch-mismatch');
    await click('.branch-mismatch__restore');
    await wait("!document.querySelector('.branch-mismatch') && !document.querySelector('.session-list__mismatch')");
    assert.equal(await git(projectPath, ['branch', '--show-current']), 'main');
    await wait(`document.querySelector(${JSON.stringify(branchTrigger)}).getAttribute('aria-label') === 'Branch: main'`);
    assert.deepEqual(errors.filter(message => !message.includes('Autofill')), []);
    console.log('FLAME_WORKTREES_UI_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'worktree-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
