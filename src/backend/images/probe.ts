// Inspect dimensions before a decoder allocates its pixel buffer. Decoding still validates the file.
export type ImageHeader = { mimeType: string; width: number; height: number; orientation: number };
function orientation(bytes: Buffer): number {
  try {
    const tiff = bytes.subarray(bytes.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 6 : 0);
    const le = tiff.toString("ascii", 0, 2) === "II";
    if (!le && tiff.toString("ascii", 0, 2) !== "MM") return 1;
    const u16 = (offset: number) => le ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const u32 = (offset: number) => le ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
    if (u16(2) !== 42) return 1;
    const start = u32(4), count = u16(start);
    for (let i = 0; i < count; i++) {
      const at = start + 2 + i * 12;
      if (u16(at) === 274 && u16(at + 2) === 3 && u32(at + 4) === 1) {
        const value = u16(at + 8); return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch { /* Missing or malformed optional orientation is not an instruction. */ }
  return 1;
}
export function probeImage(data: Uint8Array): ImageHeader {
  const b = Buffer.from(data);
  let width = 0, height = 0, mimeType = "", rotate = 1;
  try {
    if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      if (b.toString("ascii", 12, 16) !== "IHDR" || b.readUInt32BE(8) !== 13) throw new Error();
      mimeType = "image/png"; width = b.readUInt32BE(16); height = b.readUInt32BE(20);
      for (let at = 8; at + 12 <= b.length;) {
        const size = b.readUInt32BE(at), end = at + 12 + size;
        if (end > b.length) throw new Error();
        if (b.toString("ascii", at + 4, at + 8) === "eXIf") rotate = orientation(b.subarray(at + 8, end - 4));
        at = end;
      }
    } else if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) {
      mimeType = "image/gif"; width = b.readUInt16LE(6); height = b.readUInt16LE(8);
    } else if (b[0] === 255 && b[1] === 216) {
      mimeType = "image/jpeg";
      for (let at = 2; at + 3 < b.length;) {
        if (b[at++] !== 255) throw new Error();
        while (b[at] === 255) at++;
        const marker = b[at++]!;
        if (marker === 218 || marker === 217) break;
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        const size = b.readUInt16BE(at);
        if (size < 2 || at + size > b.length) throw new Error();
        if (marker === 225) rotate = orientation(b.subarray(at + 2, at + size));
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
          height = b.readUInt16BE(at + 3); width = b.readUInt16BE(at + 5);
        }
        at += size;
      }
    } else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      mimeType = "image/webp";
      for (let at = 12; at + 8 <= b.length;) {
        const tag = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4), p = at + 8;
        if (p + size > b.length) throw new Error();
        if (tag === "VP8X") { width = b.readUIntLE(p + 4, 3) + 1; height = b.readUIntLE(p + 7, 3) + 1; }
        if (tag === "VP8 " && !width) { width = b.readUInt16LE(p + 6) & 16383; height = b.readUInt16LE(p + 8) & 16383; }
        if (tag === "VP8L" && !width) { const bits = b.readUInt32LE(p + 1); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
        if (tag === "EXIF") rotate = orientation(b.subarray(p, p + size));
        at = p + size + size % 2;
      }
    }
  } catch { throw new Error("The image header is damaged or incomplete."); }
  if (!mimeType || !width || !height) throw new Error("Use a valid PNG, JPEG, WebP, or GIF image.");
  if (width > 40000 || height > 40000 || width * height > 40_000_000) throw new Error("Image exceeds the 40 megapixel decode limit.");
  return { mimeType, width, height, orientation: rotate };
}
