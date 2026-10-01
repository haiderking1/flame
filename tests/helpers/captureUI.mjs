import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function captureUI(driver,name) {
  const directory=process.env.FLAME_SCREENSHOT_DIR;
  if(!directory) return;
  await driver.settle();
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,`${name}.png`),(await driver.window.webContents.capturePage()).toPNG());
}
