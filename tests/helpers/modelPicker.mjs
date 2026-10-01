/**
 * Picks the first model in the composer's picker. The picker closes when the composer re-renders under it, such as when a
 * new thread's Git status arrives, so it is reopened until the choice lands.
 */
export async function chooseFirstModel({ wait }, label = 'Test model') {
  await wait(`(() => {
    const option = document.querySelector('.model-picker:popover-open .model-picker__option');
    if (option) { option.click(); return true; }
    if (!document.querySelector('.model-picker:popover-open')) document.querySelector('.composer .composer-settings__model')?.click();
    return false;
  })()`);
  await wait(`document.querySelector('.composer .composer-settings__model')?.getAttribute('aria-label') === ${JSON.stringify(`Select model: ${label}`)}`);
}
