import { readImageChunk } from "./read-chunk.js";
import type { DatabaseSync } from "node:sqlite";
import { unlinkSync } from "node:fs";
import { ImageInfo, MAX_IMAGES, MAX_IMAGE_BYTES, IMAGE_CHUNK_BYTES, type ImageInfo as Info } from "../../contracts/image-types.js";
import { Schema } from "effect";
import { SessionError } from "../../contracts/sessions.js";
import { checkId } from "../sessions/files.js";
import { hashImage, imagePath, readImageFile, saveImageFile } from "./files.js";
import type { PreparedImage } from "./normalize.js";
export const imageError = (message: string) => new SessionError({ code: "INVALID", message });
export class ImageStore {
  constructor(private db: DatabaseSync, private root: string, private assertOpen: () => unknown, private transaction: <T>(work: () => T) => T) {}
  private row(id: string) { this.assertOpen(); checkId(id); return this.db.prepare("SELECT * FROM images WHERE id=?").get(id); }
  info(id: string): Info | null {
    const row = this.row(id);
    return row ? Schema.decodeUnknownSync(ImageInfo)({ id, name: row.name, mimeType: row.mime_type, bytes: row.source_bytes,
      width: row.width, height: row.height, modelWidth: row.model_width, modelHeight: row.model_height,
      sha256: row.source_hash, modelSha256: row.model_hash, modelBytes: row.model_bytes, modelMimeType: row.model_mime }) : null;
  }
  begin(id: string, name: string, bytes: number, hash: string) {
    this.assertOpen(); checkId(id);
    if (!name.trim() || name.length > 255 || /[\u0000-\u001f]/.test(name) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES || !/^[0-9a-f]{64}$/.test(hash)) throw imageError("Invalid image upload. Images must be at most 20 MiB.");
    return this.transaction(() => {
      const prior = this.row(id) ?? this.db.prepare("SELECT name,hash AS source_hash,bytes AS source_bytes FROM image_uploads WHERE id=?").get(id);
      if (prior && (prior.name !== name || prior.source_hash !== hash || prior.source_bytes !== bytes)) throw imageError("This image identifier already belongs to another attachment.");
      const saved = this.info(id); if (saved) return saved;
      if (!prior) {
        const pending = Number(this.db.prepare("SELECT (SELECT COUNT(*) FROM image_uploads) + (SELECT COUNT(*) FROM images WHERE id NOT IN (SELECT image_id FROM entry_images)) AS count").get()!.count);
        if (pending >= MAX_IMAGES) throw imageError("Too many unfinished image uploads. Remove unused attachments before adding more.");
        this.db.prepare("INSERT INTO image_uploads(id,name,hash,bytes) VALUES (?,?,?,?)").run(id, name, hash, bytes);
      }
      return null;
    });
  }
  chunk(id: string, offset: number, encoded: string) {
    this.assertOpen(); checkId(id);
    const data = Buffer.from(encoded, "base64");
    if (!data.length || data.length > IMAGE_CHUNK_BYTES || data.toString("base64") !== encoded || !Number.isSafeInteger(offset) || offset < 0) throw imageError("Invalid image upload chunk.");
    this.transaction(() => {
      const upload = this.db.prepare("SELECT received,bytes FROM image_uploads WHERE id=?").get(id);
      if (!upload) throw imageError("Image upload is no longer available. Retry attaching it.");
      const prior = this.db.prepare("SELECT data FROM image_chunks WHERE id=? AND offset=?").get(id, offset);
      if (prior) { if (!Buffer.from(prior.data as Uint8Array).equals(data)) throw imageError("Image upload changed while sending."); return; }
      if (offset !== upload.received || offset + data.length > Number(upload.bytes)) throw imageError("Image chunks must arrive in order and fit the declared size.");
      this.db.prepare("INSERT INTO image_chunks VALUES (?,?,?)").run(id, offset, data);
      this.db.prepare("UPDATE image_uploads SET received=received+? WHERE id=?").run(data.length, id);
    });
  }
  source(id: string) {
    this.assertOpen(); checkId(id);
    const upload = this.db.prepare("SELECT * FROM image_uploads WHERE id=?").get(id);
    if (!upload || upload.bytes !== upload.received) throw imageError("Image upload is incomplete. Retry before sending.");
    const data = Buffer.concat(this.db.prepare("SELECT data FROM image_chunks WHERE id=? ORDER BY offset").all(id).map(row => Buffer.from(row.data as Uint8Array)));
    if (data.length !== upload.bytes || hashImage(data) !== upload.hash) throw imageError("Image upload checksum did not match. Remove it and attach the original again.");
    return { data, name: String(upload.name), hash: String(upload.hash) };
  }
  finish(id: string, source: ReturnType<ImageStore["source"]>, prepared: PreparedImage) {
    this.assertOpen();
    const existing = this.info(id); if (existing) return existing;
    const upload = this.db.prepare("SELECT hash FROM image_uploads WHERE id=?").get(id);
    if (!upload || upload.hash !== source.hash) throw imageError("Image upload was removed before preparation finished.");
    saveImageFile(this.root, id, "original", source.data); saveImageFile(this.root, id, "model", prepared.data);
    this.transaction(() => {
      this.db.prepare("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id, source.name, source.hash, source.data.length,
        prepared.originalMime, prepared.width, prepared.height, prepared.mimeType, prepared.modelWidth, prepared.modelHeight, prepared.data.length, hashImage(prepared.data));
      this.db.prepare("DELETE FROM image_uploads WHERE id=?").run(id);
    });
    return this.info(id)!;
  }
  list(entry: string): Info[] {
    this.assertOpen();
    return this.db.prepare("SELECT image_id FROM entry_images WHERE entry_id=? ORDER BY position").all(entry).map(row => this.info(String(row.image_id))!);
  }
  assertIds(ids: readonly string[]) {
    if (ids.length > MAX_IMAGES || new Set(ids).size !== ids.length) throw imageError("Attach at most 10 distinct images to one message.");
    for (const id of ids) if (!this.info(id)) throw imageError("An attachment has not finished uploading. Your message was not sent.");
  }
  bind(entry: string, ids: readonly string[]) {
    this.assertIds(ids);
    for (const id of ids) if (this.db.prepare("SELECT 1 FROM entry_images WHERE image_id=?").get(id)) throw imageError("This attachment was already sent. Remove it from the draft; attach the file again only if you intend to send it again.");
    ids.forEach((id, position) => this.db.prepare("INSERT INTO entry_images VALUES (?,?,?)").run(entry, id, position));
  }
  content(ids: readonly string[]) {
    this.assertIds(ids);
    return ids.flatMap(id => {
      const row = this.row(id)!;
      const data = readImageFile(imagePath(this.root, id, "model"), Number(row.model_bytes), String(row.model_hash));
      return [{ type: "input_text", text: `[Attached image: ${row.name}; ${row.width}×${row.height}, sent as ${row.model_width}×${row.model_height}. Animated images are sent as a still frame.]` },
        { type: "input_image", detail: "auto", image_url: `data:${row.model_mime};base64,${data.toString("base64")}` }];
    });
  }
  read(id: string, offset: number, preview = false) {
    const row = this.row(id); if (!row) throw imageError("Image unavailable. It may have been removed.");
    return readImageChunk(imagePath(this.root, id, preview ? "model" : "original"), Number(preview ? row.model_bytes : row.source_bytes), offset);
  }
  discard(id: string) {
    this.assertOpen(); checkId(id);
    if (this.db.prepare("SELECT 1 FROM entry_images WHERE image_id=?").get(id)) return;
    this.transaction(() => {
      this.db.prepare("DELETE FROM image_uploads WHERE id=?").run(id);
      this.db.prepare("DELETE FROM images WHERE id=?").run(id);
    });
    for (const variant of ["original", "model"] as const) {
      try { unlinkSync(imagePath(this.root, id, variant)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
}
