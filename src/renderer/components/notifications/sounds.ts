/**
 * Short notification chimes, made with Web Audio so no sound file is needed: a rising pair when a thread completes and a
 * falling pair when it fails. Browsers allow audio only after a gesture, so the context unlocks on the first key or click.
 */
let context: AudioContext | null = null;
/** Starts audio from a user gesture, such as choosing a sound in Settings. */
export function unlockNotificationSounds() { unlock(); }
function unlock() { context ??= new AudioContext(); if (context.state === "suspended") void context.resume(); }
export function armNotificationSounds() {
  const handler = () => unlock();
  window.addEventListener("pointerdown", handler, true); window.addEventListener("keydown", handler, true);
  return () => { window.removeEventListener("pointerdown", handler, true); window.removeEventListener("keydown", handler, true); };
}
const NOTES = { completion: [659.25, 987.77], failed: [587.33, 392] } as const;
export function playNotificationSound(kind: keyof typeof NOTES) {
  if (!context || context.state !== "running") return;
  const start = context.currentTime + 0.01;
  NOTES[kind].forEach((frequency, index) => {
    const at = start + index * 0.12, oscillator = context!.createOscillator(), gain = context!.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.18, at + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(at); oscillator.stop(at + 0.34);
  });
}
