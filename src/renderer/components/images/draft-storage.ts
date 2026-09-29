import { MAX_IMAGES, MAX_IMAGE_BYTES } from "@contracts/image-types";
export type DraftImage = { id: string; name: string; file: Blob };
const changes = new EventTarget();
let database: Promise<IDBDatabase> | undefined;
let pending = 0;
const unsaved = new Map<string, readonly DraftImage[]>();
export function pendingImageDraft(scope: string) { return unsaved.get(scope); }
export function stageImageDraft(scope: string, images: readonly DraftImage[]) { unsaved.set(scope, images); }
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
      resolve(value as DraftImage[]);
    };
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function saveImageDraft(scope: string, images: readonly DraftImage[]) {
  pending++;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite", { durability: "strict" });
      if (images.length) transaction.objectStore("drafts").put(images, scope); else transaction.objectStore("drafts").delete(scope);
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
    });
    if (unsaved.get(scope) === images) unsaved.delete(scope);
    changes.dispatchEvent(new CustomEvent(scope));
  } finally { pending--; }
}
export function watchImageDraft(scope: string, onChange: () => void) { changes.addEventListener(scope, onChange); return () => changes.removeEventListener(scope, onChange); }
