/**
 * T3 Code's resting composer. An existing thread's composer shrinks to one line while the conversation is scrolled, and
 * comes back at the end of the conversation or when the composer is used.
 */
// Wheel distance, in one gesture, that rests the composer.
export const REST_THRESHOLD_PX = 24;
// A gesture ends after this long without wheel events.
export const GESTURE_RESET_MS = 120;
// Within this distance of the end, the conversation counts as at its end.
export const AT_END_PX = 40;
// Narrower windows keep the full composer.
export const MIN_WIDTH_PX = 640;
const LINE_PX = 16;

export type RestingGate = {
  enabled: boolean; // The "Collapse composer on scroll" setting.
  thread: boolean; // An existing thread, not a new one being written.
  wide: boolean; // At least MIN_WIDTH_PX wide.
  overflows: boolean; // The conversation is taller than its view.
  scrolled: boolean; // A scroll gesture rested it, and nothing has expanded it since.
  multiline: boolean; // The draft takes more than one line.
  held: boolean; // Something only the full composer shows: a menu, a drag, an error.
};
export const shouldRest = (gate: RestingGate) =>
  gate.enabled && gate.thread && gate.wide && gate.overflows && gate.scrolled && !gate.multiline && !gate.held;

export const atEnd = (view: { scrollTop: number; scrollHeight: number; clientHeight: number }) =>
  view.scrollHeight - view.clientHeight - view.scrollTop <= AT_END_PX;

/** A wheel delta in pixels, whatever unit the device reported. */
export const wheelPixels = (deltaY: number, deltaMode: number, pageHeight: number) =>
  Math.abs(deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * pageHeight : deltaY);

/** Wheel distance across one gesture. An edit suppresses the rest of the gesture, so its momentum cannot rest the composer again. */
export class WheelGesture {
  private total = 0;
  private last = Number.NEGATIVE_INFINITY;
  private suppressed = false;
  /** Adds a wheel event; true once the gesture has gone far enough to rest the composer. */
  add(pixels: number, now: number) {
    if (now - this.last > GESTURE_RESET_MS) { this.total = 0; this.suppressed = false; }
    this.last = now;
    if (this.suppressed) return false;
    this.total += pixels;
    return this.total >= REST_THRESHOLD_PX;
  }
  suppress(now: number) { this.suppressed = true; this.total = 0; this.last = now; }
  reset() { this.total = 0; this.suppressed = false; this.last = Number.NEGATIVE_INFINITY; }
}

/** Whether a scrolling key rests the composer: Page Up and Home away from the top, Page Down and End away from the end. */
export function scrollKeyRests(key: string, view: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  if (key === "PageUp" || key === "Home") return view.scrollTop > 1;
  if (key === "PageDown" || key === "End") return !atEnd(view);
  return false;
}

/** At most this many images show beside a resting draft; the rest are counted. */
export const RESTING_IMAGE_LIMIT = 3;
