/** Picks an option in a styled select menu (the settings dropdowns): opens it by its label, then clicks the option. */
export async function chooseOption({ click, wait, evaluate }, label, option) {
  const trigger = `button[aria-label=${JSON.stringify(label)}]`;
  await click(trigger);
  await wait(`!!document.querySelector('[role=menu][aria-label=${JSON.stringify(label)}]:popover-open')`);
  await evaluate(`[...document.querySelectorAll('[role=menu][aria-label=${JSON.stringify(label)}] [role=menuitemradio]')].find(item => item.textContent === ${JSON.stringify(option)}).click()`);
}
/** The option a styled select menu shows as chosen. */
export const chosenOption = label => `document.querySelector('button[aria-label=${JSON.stringify(label)}]')?.textContent`;
