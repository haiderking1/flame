import { imageThumbnail } from "./thumbnail";

type Preview = { owners: number; url: string | null; ready: Promise<string | null>; disposed: boolean; timer?: ReturnType<typeof setTimeout> };
const previews = new WeakMap<Blob, Preview>();

export function cachedThumbnailUrl(file: Blob) { return previews.get(file)?.url ?? null; }

// A thumbnail can move between React owners during Send. Share its decoded
// URL, and defer final release until the new owner's effects can retain it.
export function retainThumbnailUrl(file: Blob) {
  let preview = previews.get(file);
  if (!preview) {
    preview = { owners: 0, url: null, ready: Promise.resolve(null), disposed: false };
    const created = preview;
    previews.set(file, created);
    created.ready = (async () => {
      const blob = await imageThumbnail(file);
      if (!blob || created.disposed) return null;
      const url = URL.createObjectURL(blob);
      try {
        const decoded = new Image(); decoded.src = url;
        await decoded.decode();
        if (created.disposed) { URL.revokeObjectURL(url); return null; }
        created.url = url; return url;
      } catch { URL.revokeObjectURL(url); return null; }
    })();
  }
  const owned = preview;
  clearTimeout(owned.timer); owned.owners++;
  let released = false;
  return {
    ready: owned.ready,
    release() {
      if (released) return;
      released = true;
      if (--owned.owners) return;
      owned.timer = setTimeout(() => {
        if (owned.owners) return;
        owned.disposed = true;
        if (owned.url) URL.revokeObjectURL(owned.url);
        if (previews.get(file) === owned) previews.delete(file);
      }, 0);
    },
  };
}
