import { useEffect, useId, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import { MAX_IMAGES, MAX_IMAGE_BYTES } from "@contracts/image-types";
import { discardImage } from "../../backend/images";
import { readImageDraft, saveImageDraft, pendingImageDraft, stageImageDraft, watchImageDraft, type DraftImage } from "./draft-storage";
export function useImageDraft(location?: SessionLocation) {
  const scope = location ? `${location.projectId}:${location.sessionId}` : "";
  const [images, setImages] = useState<DraftImage[]>([]), current = useRef(images);
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const dirty = useRef(false), queue = useRef(Promise.resolve());
  const instance = useId();
  const discard = useAtomSet(discardImage(instance), { mode: "promise" });
  function adopt(value: DraftImage[]) { current.current = value; setImages(value); }
  async function load() {
    const retained = pendingImageDraft(scope);
    if (retained) { adopt([...retained]); dirty.current = true; setReady(true); setError("Your image draft is still unsaved. Retry saving before sending."); return; }
    try { const saved = await readImageDraft(scope); if (!dirty.current) { adopt(saved); setReady(true); setError(null); } }
    catch { setError("Could not read the saved image draft. It has not been overwritten. Retry when storage is available."); }
  }
  useEffect(() => {
    if (!scope) return;
    void load();
    return watchImageDraft(scope, () => { if (!dirty.current) void load(); });
  }, [scope]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function flush() {
    if (!scope || !ready) throw new Error("Image draft is unavailable");
    const value = current.current;
    dirty.current = true; stageImageDraft(scope, value); setSaving(true);
    const task = queue.current.then(() => saveImageDraft(scope, value));
    queue.current = task.catch(() => {});
    try { await task; if (current.current === value) dirty.current = false; setError(null); }
    catch { setError("Could not save your image draft. Free some storage and retry; your attachments are still here."); throw new Error("Could not save image draft"); }
    finally { setSaving(false); }
  }
  async function add(files: readonly File[]) {
    if (!ready) return;
    const accepted: DraftImage[] = [], rejected: string[] = [];
    for (const file of files) {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name) && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { rejected.push(`${file.name}: use PNG, JPEG, WebP, or GIF.`); continue; }
      if (!file.size || file.size > MAX_IMAGE_BYTES) { rejected.push(`${file.name}: images must be at most 20 MiB.`); continue; }
      if (file.name.length > 255 || /[\u0000-\u001f]/.test(file.name)) { rejected.push("Rename the image to a filename without control characters and at most 255 characters."); continue; }
      if (current.current.length + accepted.length >= MAX_IMAGES) { rejected.push("Attach at most 10 images to one message."); break; }
      accepted.push({ id: crypto.randomUUID(), name: file.name, file });
    }
    if (accepted.length) { adopt([...current.current, ...accepted]); try { await flush(); } catch { return; } }
    if (rejected.length) setError(rejected.join(" "));
  }
  async function remove(id: string) {
    adopt(current.current.filter(image => image.id !== id));
    try { await flush(); if (location) await discard({ ...location, id }); }
    catch { /* Local persistence failure remains visible; remote cleanup is safe to retry. */ }
  }
  async function sent(ids: readonly string[]) {
    adopt(current.current.filter(image => !ids.includes(image.id)));
    try { await flush(); } catch { /* The accepted message must never be resent because local cleanup failed. */ }
  }
  return { images, ready: !scope || ready, saving, error, add, remove, flush, sent,
    retry: () => { if (ready) void flush().catch(() => {}); else void load(); } };
}
