import assert from 'node:assert/strict';
import { captureUI } from './captureUI.mjs';

const trigger = '.git-settings .composer-settings__model';
const description = "(document.querySelector('#git-text-model-description')?.textContent ?? '')";
async function openGitSettings({ click, wait, evaluate }) {
  await click('.sidebar-footer [aria-label="Settings"]');
  await wait("!!document.querySelector('.settings-navigation')");
  await evaluate("[...document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === 'Git').click()");
  await wait(`!!document.querySelector(${JSON.stringify(trigger)}) && document.querySelector('.settings-page__breadcrumb').textContent.endsWith('Git')`);
}
async function closeSettings({ click, wait }) {
  await click('[aria-label="Close settings"]');
  await wait("!document.querySelector('.settings-page')");
}

/** Picks a dedicated Git text model in Settings, so the Git checks that follow must generate text with it. */
export async function chooseGitTextModel(driver, name) {
  const { click, wait, evaluate } = driver;
  await openGitSettings(driver);
  await wait(`document.querySelector(${JSON.stringify(trigger)}).getAttribute('aria-label') === 'Select model: Same as chat' && ${description}.includes('composer')`);
  assert.equal(await evaluate("!!document.querySelector('.git-settings .composer-settings__thinking, .git-settings__reset')"), false, 'following the chat model has nothing to tune or reset');
  await click(trigger);
  await wait("!!document.querySelector('.git-settings .model-picker:popover-open .model-picker__option')");
  await captureUI(driver, 'git-settings-picker');
  await evaluate(`[...document.querySelectorAll('.git-settings .model-picker:popover-open .model-picker__option')].find(option => option.querySelector('.model-picker__name').textContent === ${JSON.stringify(name)}).click()`);
  await wait(`document.querySelector(${JSON.stringify(trigger)}).getAttribute('aria-label') === ${JSON.stringify(`Select model: ${name}`)} && !document.querySelector('.git-settings .model-picker:popover-open')`);
  await wait("!!document.querySelector('.git-settings .composer-settings__thinking') && !!document.querySelector('.git-settings__reset')");
  assert.match(await evaluate(description), /Writes every commit message/);
  assert.ok(await evaluate("(() => { const content = document.querySelector('.settings-page__content'); return content.scrollWidth <= content.clientWidth; })()"), 'the Git row fits without horizontal scrolling');
  await captureUI(driver, 'git-settings-chosen');
  await closeSettings(driver);
}

/** Returns Git text to the chat model and checks the row says so again. */
export async function resetGitTextModel(driver) {
  const { click, wait } = driver;
  await openGitSettings(driver);
  await click('.git-settings__reset');
  await wait(`document.querySelector(${JSON.stringify(trigger)}).getAttribute('aria-label') === 'Select model: Same as chat' && !document.querySelector('.git-settings__reset') && ${description}.includes('composer')`);
  await closeSettings(driver);
}
