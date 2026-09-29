const cache = new WeakMap<Blob, Promise<Blob | null>>();
// Crop before downsampling so a small tile does not rely on scaling a full screenshot at paint time.
export function imageThumbnail(file: Blob): Promise<Blob | null> {
  const saved = cache.get(file); if (saved) return saved;
  const result = (async () => {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height), dimension = Math.min(256, side);
      if (!dimension) return null;
      const canvas = new OffscreenCanvas(dimension, dimension), context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, dimension, dimension);
      return await canvas.convertToBlob({ type: "image/png" });
    } catch { return null; }
    finally { bitmap?.close(); }
  })();
  cache.set(file, result); return result;
}
