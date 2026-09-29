import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { hashImage } from '../../dist/backend/images/files.js';
import { IMAGE_CHUNK_BYTES } from '../../dist/contracts/image-types.js';

function chunk(type, data) {
  const name = Buffer.from(type), crcInput = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); name.copy(result, 4); data.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export function png(width = 2, height = 2) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4; pixels[offset] = 70; pixels[offset + 1] = x % 255; pixels[offset + 2] = y % 255; pixels[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export async function upload(h, images, data = png(), name = 'reference.png', id = randomUUID()) {
  h.sessions.images(h.location, store => {
    store.begin(id, name, data.length, hashImage(data));
    for (let offset = 0; offset < data.length; offset += IMAGE_CHUNK_BYTES) store.chunk(id, offset, data.subarray(offset, offset + IMAGE_CHUNK_BYTES).toString('base64'));
  });
  const info = await images.finish(h.location, id, new AbortController().signal);
  return { id, info, data };
}
