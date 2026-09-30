import { useEffect, useId, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import { MAX_IMAGES, MAX_IMAGE_BYTES } from "@contracts/image-types";
import { discardImage, stagedImages } from "../../backend/images";
import { readImageDraft, saveImageDraft, pendingImageDraft, isImageDraftSaving, stageImageDraft, removeAcceptedImageDraft, remainingImageDraft, watchImageDraft, type DraftImage } from "./draft-storage";
import { imageUploads, restoreImageUploads } from "./background-uploads";

export function useImageDraft(location?: SessionLocation) {
  const scope = location ? `${location.projectId}:${location.sessionId}` : "";
  const [images, setImages] = useState<DraftImage[]>([]), current = useRef(images);
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const dirty = useRef(false), writes = useRef(0), queue = useRef(Promise.resolve()), generation = useRef(0);
  const inherited = useRef<readonly DraftImage[] | null>(null);
  const instance = useId();
  const discard = useAtomSet(discardImage(instance), { mode: "promise" });
  const staged = useAtomSet(stagedImages(instance), { mode: "promise" });
  function adopt(value: DraftImage[]) { current.current = value; setImages(value); }
  function edit(value: DraftImage[]) { inherited.current = null; dirty.current = true; adopt(stageImageDraft(scope, value)); }
  async function load(epoch = generation.current) {
    const retained = pendingImageDraft(scope);
    if (retained) {
      const saving = isImageDraftSaving(scope);
      inherited.current = retained; adopt(retained as DraftImage[]); dirty.current = true; setReady(true); setSaving(saving);
      setError(saving ? null : "Your image draft is still unsaved. Retry saving before sending."); return;
    }
    try {
      const saved = await readImageDraft(scope);
      if (generation.current !== epoch || dirty.current) return;
      inherited.current = null; adopt(saved); setReady(true); setSaving(false); setError(null);
      if (location) void restoreImageUploads(location, saved, ids => staged({ ...location, ids })).catch(error => { if (generation.current === epoch) setError(error instanceof Error ? error.message : "Could not restore image uploads."); });
    } catch { if (generation.current === epoch) setError("Could not read the saved image draft. It has not been overwritten. Retry when storage is available."); }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    dirty.current = false; inherited.current = null; current.current = []; writes.current = 0; setImages([]); setReady(false); setError(null); setSaving(false);
    if (!scope) return;
    const release = imageUploads.retain(location!);
    void load(epoch);
    const unwatch = watchImageDraft(scope, () => {
      const remaining = remainingImageDraft(scope, current.current);
      if (remaining !== current.current) adopt(remaining);
      if (inherited.current && pendingImageDraft(scope) !== inherited.current) { dirty.current = false; inherited.current = null; }
      if (!dirty.current || inherited.current) void load(epoch);
    });
    return () => { generation.current++; unwatch(); release(); };
  }, [scope]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function flush() {
    if (!scope || !ready) throw new Error("Image draft is unavailable");
    if (!dirty.current) return;
    const value = current.current, epoch = generation.current;
    stageImageDraft(scope, value); writes.current++; setSaving(true);
    const task = queue.current.then(() => saveImageDraft(scope, value)); queue.current = task.then(() => {}, () => {});
    try {
      const saved = remainingImageDraft(scope, await task);
      const submitted = remainingImageDraft(scope, value);
      if (generation.current === epoch && submitted.length === current.current.length && submitted.every((image, index) => image === current.current[index])) {
        dirty.current = false; inherited.current = null; adopt(saved);
      }
      if (generation.current === epoch) setError(null);
      if (location) await imageUploads.enqueue(location, generation.current === epoch ? saved.filter(image => current.current.some(item => item.id === image.id)) : saved);
    } catch {
      if (generation.current === epoch) setError("Could not save your image draft. Free some storage and retry; your attachments are still here.");
      throw new Error("Could not save image draft");
    } finally { if (generation.current === epoch) { writes.current--; setSaving(writes.current > 0); } }
  }
  async function add(files: readonly File[]) {
    if (!ready) return;
    const accepted: DraftImage[] = [], rejected: string[] = [];
    for (const file of files) {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name) && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { rejected.push(`${file.name}: use PNG, JPEG, WebP, or GIF.`); continue; }
      if (!file.size || file.size > MAX_IMAGE_BYTES) { rejected.push(`${file.name}: images must be at most 20 MiB.`); continue; }
      if (!file.name.trim() || file.name.length > 255 || /[\u0000-\u001f]/.test(file.name)) { rejected.push("Rename the image to a filename without control characters and at most 255 characters."); continue; }
      if (current.current.length + accepted.length >= MAX_IMAGES) { rejected.push("Attach at most 10 images to one message."); break; }
      accepted.push({ id: crypto.randomUUID(), name: file.name, file });
    }
    if (accepted.length) { edit([...current.current, ...accepted]); try { await flush(); } catch { return; } }
    if (rejected.length) setError(rejected.join(" "));
  }
  async function remove(id: string) {
    edit(current.current.filter(image => image.id !== id));
    const cleanup = location ? imageUploads.remove(location, id, () => discard({ ...location, id })) : Promise.resolve();
    void cleanup.catch(() => {});
    try { await flush(); await cleanup; }
    catch { void cleanup.catch(() => {}); /* A failed local save remains retryable; background uploads cannot recreate this attachment. */ }
  }
  async function sent(ids: readonly string[]) {
    if (location) imageUploads.forget(location, ids);
    try { await removeAcceptedImageDraft(scope, ids); }
    catch { /* An accepted message must never be replayed because local cleanup failed. */ }
  }
  return { images, ready: !scope || ready, saving, error, add, remove, flush, sent,
    retry: () => { if (ready) void flush().catch(() => {}); else void load(); } };
}
