import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import photon from "@silvia-odwyer/photon-node";

// The sizes Linux desktops look up in the hicolor icon theme.
const LINUX_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];

/**
 * Writes the icons electron-builder packages, from the 1024 px master: the master itself for macOS and Windows, which
 * electron-builder turns into .icns and .ico, and a set of sized PNGs for Linux, named by size as Linux packaging needs.
 */
export async function writeIcons(master, directory) {
  const source = await readFile(master);
  await mkdir(join(directory, "icons"), { recursive: true });
  await writeFile(join(directory, "icon.png"), source);
  for (const size of LINUX_SIZES) {
    const image = photon.PhotonImage.new_from_byteslice(source);
    const resized = photon.resize(image, size, size, photon.SamplingFilter.Lanczos3);
    await writeFile(join(directory, "icons", `${size}x${size}.png`), resized.get_bytes());
    image.free(); resized.free();
  }
}
