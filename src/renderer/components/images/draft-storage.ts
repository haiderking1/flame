import { MAX_IMAGES, MAX_IMAGE_BYTES } from "@contracts/image-types";
export type DraftImage = { id: string; name: string; file: Blob };
const changes = new EventTarget();
let database: Promise<IDBDatabase> | undefined;
let pending = 0;
const unsaved = new Map<string, readonly DraftImage[]>();
const accepted = new Map<string, Set<string>>();
const writes = new Map<string, Promise<unknown>>();
export function remainingImageDraft(scope: string, images: readonly DraftImage[]): DraftImage[] {
  const ids = accepted.get(scope);
  return ids && images.some(image => ids.has(image.id)) ? images.filter(image => !ids.has(image.id)) : images as DraftImage[];
}
export function pendingImageDraft(scope: string) { return unsaved.get(scope); }
export function isImageDraftSaving(scope: string) { return writes.has(scope); }
export function stageImageDraft(scope: string, images: readonly DraftImage[]) { const value = remainingImageDraft(scope, images); unsaved.set(scope, value); return value; }
window.addEventListener("beforeunload", event => { if (pending || unsaved.size) { event.preventDefault(); event.returnValue = ""; } });
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("flame-image-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Close older Flame windows to unlock image drafts.")); };
  });
}
export async function readImageDraft(scope: string): Promise<DraftImage[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readonly"), request = transaction.objectStore("drafts").get(scope);
    transaction.oncomplete = () => {
      const value: unknown = request.result ?? [];
      if (!Array.isArray(value) || value.length > MAX_IMAGES || value.some(image => !image || typeof image.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(image.id) || typeof image.name !== "string" || !image.name.trim() || image.name.length > 255 || /[\u0000-\u001f]/.test(image.name) || !(image.file instanceof Blob) || !image.file.size || image.file.size > MAX_IMAGE_BYTES) || new Set(value.map(image => image.id)).size !== value.length) { reject(new Error("Image draft is damaged. It was not overwritten.")); return; }
      resolve(remainingImageDraft(scope, value as DraftImage[]));
    };
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function saveImageDraft(scope: string, images: readonly DraftImage[]) {
  pending++;
  try {
    const task = (writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const value = remainingImageDraft(scope, images), db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("drafts", "readwrite", { durability: "strict" });
        if (value.length) transaction.objectStore("drafts").put(value, scope); else transaction.objectStore("drafts").delete(scope);
        transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
      });
      if (unsaved.get(scope) === images || unsaved.get(scope) === value) unsaved.delete(scope);
      changes.dispatchEvent(new CustomEvent(scope));
      return remainingImageDraft(scope, value);
    });
    writes.set(scope, task);
    try { return await task; } finally {
      if (writes.get(scope) === task) { writes.delete(scope); changes.dispatchEvent(new CustomEvent(scope)); }
    }
  } finally { pending--; }
}
export async function removeAcceptedImageDraft(scope: string, ids: readonly string[]) {
  if (!scope || !ids.length) return;
  const consumed = accepted.get(scope) ?? new Set<string>();
  for (const id of ids) consumed.add(id);
  accepted.set(scope, consumed);
  const pending = pendingImageDraft(scope);
  if (pending) stageImageDraft(scope, pending);
  changes.dispatchEvent(new CustomEvent(scope));
  const saved = pendingImageDraft(scope) ?? await readImageDraft(scope);
  // A new owner may have edited while the stored draft was loading. Preserve
  // that latest draft and remove only IDs acknowledged by the accepted send.
  const value = stageImageDraft(scope, pendingImageDraft(scope) ?? saved);
  const saving = saveImageDraft(scope, value);
  changes.dispatchEvent(new CustomEvent(scope));
  await saving;
}
export function watchImageDraft(scope: string, onChange: () => void) { changes.addEventListener(scope, onChange); return () => changes.removeEventListener(scope, onChange); }
