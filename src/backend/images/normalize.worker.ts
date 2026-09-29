import { parentPort, workerData } from "node:worker_threads";
import * as photon from "@silvia-odwyer/photon-node";
import { probeImage } from "./probe.js";

// CPU/WASM work stays off the backend event loop. Each worker is discarded after one image.
try {
  const source = new Uint8Array(workerData), header = probeImage(source);
  let image = photon.PhotonImage.new_from_byteslice(source);
  try {
    if (image.get_width() !== header.width || image.get_height() !== header.height) throw new Error("Image dimensions do not match its header.");
    if (header.orientation > 1) {
      const w = image.get_width(), h = image.get_height(), swap = header.orientation >= 5;
      const pixels = image.get_raw_pixels(), oriented = new Uint8Array(pixels.length), width = swap ? h : w;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [dx, dy] = header.orientation === 2 ? [w-1-x, y] : header.orientation === 3 ? [w-1-x, h-1-y]
          : header.orientation === 4 ? [x, h-1-y] : header.orientation === 5 ? [y, x]
          : header.orientation === 6 ? [h-1-y, x] : header.orientation === 7 ? [h-1-y, w-1-x] : [y, w-1-x];
        oriented.set(pixels.subarray((y*w+x)*4, (y*w+x)*4+4), (dy!*width+dx!)*4);
      }
      const rotated = new photon.PhotonImage(oriented, width, swap ? w : h); image.free(); image = rotated;
    }
    const width = image.get_width(), height = image.get_height(), scale = Math.min(1, 2000 / width, 2000 / height);
    let w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    let result: { data: Uint8Array; mimeType: string } | undefined;
    while (!result) {
      const resized = photon.resize(image, w, h, photon.SamplingFilter.Lanczos3);
      try {
        const png = resized.get_bytes();
        if (Math.ceil(png.length / 3) * 4 < 4.5 * 1024 * 1024) result = { data: png, mimeType: "image/png" };
        else for (const quality of [80, 70, 55, 40]) {
          const jpg = resized.get_bytes_jpeg(quality);
          if (Math.ceil(jpg.length / 3) * 4 < 4.5 * 1024 * 1024) { result = { data: jpg, mimeType: "image/jpeg" }; break; }
        }
      } finally { resized.free(); }
      if (!result) {
        if (w === 1 && h === 1) throw new Error("Could not prepare the image within the model image limit.");
        w = Math.max(1, Math.floor(w * .75)); h = Math.max(1, Math.floor(h * .75));
      }
    }
    parentPort!.postMessage({ ...result, originalMime: header.mimeType, width, height, modelWidth: w, modelHeight: h });
  } finally { image.free(); }
} catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : "Could not decode the image." }); }
