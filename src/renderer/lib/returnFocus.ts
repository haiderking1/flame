// Whether the latest input was the keyboard. A menu used with the mouse must not leave its trigger looking focused:
// Chromium carries :focus-visible over from the menu's search field when focus moves back by script.
let keyboard = false;
window.addEventListener("keydown", () => { keyboard = true; }, true);
window.addEventListener("pointerdown", () => { keyboard = false; }, true);

/** Gives focus back to a menu's trigger; it shows as focused only when the menu was used with the keyboard. */
export function returnFocus(element: HTMLElement | null | undefined, options: { preventScroll?: boolean } = {}) {
  if (!element) return;
  if (!keyboard && document.activeElement === element) element.blur();
  element.focus({ ...options, focusVisible: keyboard } as FocusOptions);
}

/** For a menu that just closed on its own (a click outside): the browser hands focus back to the trigger, which must not look focused after mouse use. */
export function settleTriggerFocus(element: HTMLElement | null | undefined) {
  if (element && document.activeElement === element) returnFocus(element);
}
