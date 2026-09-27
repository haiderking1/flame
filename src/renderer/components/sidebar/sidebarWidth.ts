const STORAGE_KEY = "flame.sidebar.width";
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MIN_WIDTH = 208;

export function sidebarMaximumWidth(viewportWidth: number) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.floor(viewportWidth) - 640);
}

export function loadSidebarWidth() {
  let preferred = SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof stored === "number" && Number.isFinite(stored)) {
      preferred = Math.max(SIDEBAR_MIN_WIDTH, stored);
    }
  } catch {
    // An unavailable store or invalid preference must not block startup.
  }
  return preferred;
}

export function saveSidebarWidth(width: number) {
  if (!Number.isFinite(width) || width < SIDEBAR_MIN_WIDTH) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(width));
  } catch {
    // Resizing remains usable when persistence is unavailable.
  }
}
