import { readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { ImageInfo, MAX_IMAGES, MAX_IMAGE_BYTES, type ImageInfo as Info } from "../../contracts/image-types.js";
import type { SessionLocation } from "../../contracts/sessions.js";
import { checkId, directory, syncDirectory, validId } from "../sessions/files.js";
import { hashImage, imagePath, readImageFile, saveImageFile } from "./files.js";
import { imageMetadata } from "./metadata.js";
import type { PreparedImage } from "./normalize.js";
import { imageError } from "./store.js";
import { readImageChunk } from "./read-chunk.js";
import { readStagingJson, saveStagingJson } from "./staging-files.js";

export type StagedUpload = SessionLocation & { id: string; name: string; bytes: number; sha256: string };
type Manifest = { version: 1; id: string; name: string; bytes: number; sha256: string; createdAt: number; info?: Info; removed?: false }
  | { version: 1; id: string; createdAt: number; removed: true };
export type StagedImage = { info: Info; originalPath: string; modelPath: string };
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STAGED_BYTES = 512 * 1024 * 1024;

export class ImageStaging {
  private lastCleanup = 0;
  constructor(private root: string, private assertLocation: (location: SessionLocation) => void, private now: () => number = Date.now) {
    directory(root, true); this.cleanup();
  }
  private folder(location: SessionLocation, create = false, validate = true): string {
    checkId(location.projectId); checkId(location.sessionId); if (validate) this.assertLocation(location);
    const project = join(this.root, location.projectId);
    directory(project, create);
    const session = join(project, location.sessionId); directory(session, create); return session;
  }
  private manifest(root: string, id: string): Manifest | null {
    checkId(id);
    let raw: unknown;
    try { raw = readStagingJson(join(root, `${id}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const value = raw as Manifest;
    if (!value || value.version !== 1 || value.id !== id || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new Error("Invalid staged image metadata.");
    if (value.removed === true) return value;
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 255 || /[\u0000-\u001f]/.test(value.name)
      || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_IMAGE_BYTES || !/^[0-9a-f]{64}$/.test(value.sha256)
      ) throw new Error("Invalid staged image metadata.");
    if (value.info) {
      const info = Schema.decodeUnknownSync(ImageInfo)(value.info);
      if (info.id !== id || info.name !== value.name || info.sha256 !== value.sha256 || info.bytes !== value.bytes
        || !Number.isSafeInteger(info.modelBytes) || info.modelBytes < 1 || info.modelBytes > MAX_IMAGE_BYTES
        || !/^[0-9a-f]{64}$/.test(info.modelSha256)) throw new Error("Invalid staged image metadata.");
    }
    return value;
  }
  validate(value: StagedUpload) {
    checkId(value.id); checkId(value.projectId); checkId(value.sessionId); this.assertLocation(value);
    if (!value.name.trim() || value.name.length > 255 || /[\u0000-\u001f]/.test(value.name)
      || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_IMAGE_BYTES || !/^[0-9a-f]{64}$/.test(value.sha256)) throw imageError("Invalid image upload. Images must be at most 20 MiB.");
  }
  claim(value: StagedUpload): { root: string; ready: Info | null } {
    this.validate(value); this.cleanup();
    const root = this.folder(value, true), prior = this.manifest(root, value.id);
    if (prior) {
      if (prior.removed) throw imageError("This attachment was removed. Attach the file again with a new image identifier.");
      if (prior.name !== value.name || prior.bytes !== value.bytes || prior.sha256 !== value.sha256) throw imageError("This image identifier already belongs to another attachment.");
      return { root, ready: prior.info ?? null };
    }
    const uploads = readdirSync(root).filter(name => validId(name.replace(/\.json$/, "")) && name.endsWith(".json") && !this.manifest(root, name.slice(0, -5))?.removed);
    if (uploads.length >= MAX_IMAGES) throw imageError("Attach at most 10 images to one draft. Remove unused images before adding more.");
    if (this.stagedBytes() + value.bytes > MAX_STAGED_BYTES) throw imageError("Image staging is full. Remove unused attachments before uploading more.");
    saveStagingJson(root, value.id, { version: 1, id: value.id, name: value.name, bytes: value.bytes, sha256: value.sha256, createdAt: this.now() } satisfies Manifest);
    return { root, ready: null };
  }
  ready(location: SessionLocation, id: string): Info | null {
    checkId(id);
    let root: string;
    try { root = this.folder(location); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const manifest = this.manifest(root, id);
    if (!manifest || manifest.removed || !manifest.info) return null;
    if (this.now() - manifest.createdAt > STAGING_TTL_MS) { this.remove(root, id); return null; }
    // A ready response proves both immutable artifacts still exist and match.
    readImageFile(imagePath(root, id, "original"), manifest.info.bytes, manifest.info.sha256);
    readImageFile(imagePath(root, id, "model"), manifest.info.modelBytes, manifest.info.modelSha256);
    return manifest.info;
  }
  complete(value: StagedUpload, original: Uint8Array, prepared: PreparedImage): Info {
    this.validate(value);
    const root = this.folder(value), prior = this.manifest(root, value.id);
    if (!prior || prior.removed || prior.name !== value.name || prior.bytes !== original.length || prior.sha256 !== hashImage(original)) throw imageError("Image upload was removed or changed before preparation finished.");
    if (prior.info) return this.ready(value, value.id)!;
    const info = imageMetadata(value.id, value.name, original, prepared);
    saveImageFile(root, value.id, "original", original); saveImageFile(root, value.id, "model", prepared.data);
    // Only this final durable metadata rename makes an image ready to send.
    saveStagingJson(root, value.id, { ...prior, info }); return info;
  }
  artifacts(location: SessionLocation, id: string): StagedImage | null {
    let root: string;
    try { root = this.folder(location); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const manifest = this.manifest(root, id);
    if (!manifest || manifest.removed || !manifest.info) return null;
    if (this.now() - manifest.createdAt > STAGING_TTL_MS) { this.remove(root, id); return null; }
    // copyImageFile verifies the immutable files as it adopts them; do not
    // hash the same original/model a second time before that copy.
    return { info: manifest.info, originalPath: imagePath(root, id, "original"), modelPath: imagePath(root, id, "model") };
  }
  read(location: SessionLocation, id: string, offset: number, preview = false) {
    const info = this.ready(location, id); if (!info) return null;
    return readImageChunk(imagePath(this.folder(location), id, preview ? "model" : "original"), preview ? info.modelBytes : info.bytes, offset);
  }
  discard(location: SessionLocation, id: string) {
    checkId(id);
    let root: string;
    try { root = this.folder(location, false, false); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A remove can precede its queued HTTP request, but it must still name
      // an existing project. Already staged deleted targets may be cleaned up.
      this.assertLocation(location); root = this.folder(location, true, false);
    }
    // Persist the removal before deleting bytes. An HTTP request that arrives
    // after the remove RPC cannot resurrect the same attachment identifier.
    saveStagingJson(root, id, { version: 1, id, createdAt: this.now(), removed: true } satisfies Manifest);
    this.remove(root, id, false);
  }
  resetPending(location: SessionLocation, id: string) {
    const root = this.folder(location, false, false), manifest = this.manifest(root, id);
    if (manifest && !manifest.removed && !manifest.info) this.remove(root, id, false);
  }
  private remove(root: string, id: string, metadata = true) {
    for (const name of [...(metadata ? [`${id}.json`] : []), `${id}.original`, `${id}.model`]) {
      try { unlinkSync(join(root, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    syncDirectory(root);
  }
  private folders(): string[] {
    const result: string[] = [];
    for (const project of readdirSync(this.root).filter(validId)) {
      const path = join(this.root, project); directory(path);
      for (const session of readdirSync(path).filter(validId)) { const folder = join(path, session); directory(folder); result.push(folder); }
    }
    return result;
  }
  private stagedBytes() {
    let bytes = 0;
    for (const root of this.folders()) for (const name of readdirSync(root)) {
      if (!name.endsWith(".json") || !validId(name.slice(0, -5))) continue;
      const manifest = this.manifest(root, name.slice(0, -5));
      bytes += manifest && !manifest.removed ? manifest.bytes : 0;
    }
    return bytes;
  }
  cleanup() {
    const now = this.now(); if (this.lastCleanup && now - this.lastCleanup < 60_000) return;
    this.lastCleanup = now;
    for (const root of this.folders()) for (const name of readdirSync(root)) {
      if (name.endsWith(".json") && validId(name.slice(0, -5))) {
        const manifest = this.manifest(root, name.slice(0, -5));
        if (manifest && now - manifest.createdAt > STAGING_TTL_MS) this.remove(root, manifest.id);
      } else if (/^\.[0-9a-f-]+(?:\.[0-9a-f-]+)?\.(upload|metadata)$/.test(name) && now - statSync(join(root, name)).mtimeMs > STAGING_TTL_MS) {
        unlinkSync(join(root, name)); syncDirectory(root);
      }
    }
  }
}
