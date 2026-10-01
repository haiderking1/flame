/**
 * Joins the update manifests that per-architecture builds wrote, so one feed serves both: electron-updater picks the file
 * for the machine's architecture from the merged list. macOS builds upload <channel>-mac.yml (arm64) and
 * <channel>-mac-x64.yml; Windows builds upload <channel>-win-x64.yml and <channel>-win-arm64.yml. Linux needs no merge:
 * each architecture has its own feed.
 *
 *   node scripts/desktop/merge-update-manifests.mjs <directory>
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

/** One manifest from several: the files of all, the newest release date, the first one's main file. */
export function mergeManifests(manifests) {
  const [first] = manifests;
  for (const manifest of manifests) if (manifest.version !== first.version) throw new Error(`Cannot merge update manifests of ${first.version} and ${manifest.version}.`);
  const files = [];
  for (const manifest of manifests) for (const file of manifest.files ?? []) if (!files.some(item => item.url === file.url)) files.push(file);
  const releaseDate = manifests.map(manifest => manifest.releaseDate).filter(Boolean).sort().at(-1);
  return { ...first, files, ...(releaseDate ? { releaseDate } : {}) };
}

function merge(directory, sources, target) {
  const present = sources.map(name => join(directory, name)).filter(existsSync);
  if (!present.length) return;
  const merged = mergeManifests(present.map(path => yaml.load(readFileSync(path, "utf8"))));
  for (const path of present) rmSync(path);
  writeFileSync(join(directory, target), yaml.dump(merged, { lineWidth: -1 }));
  console.log(`${target}: ${merged.files.map(file => file.url).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: merge-update-manifests.mjs <directory>");
  for (const channel of ["latest", "nightly"]) {
    merge(directory, [`${channel}-mac.yml`, `${channel}-mac-x64.yml`], `${channel}-mac.yml`);
    merge(directory, [`${channel}-win-x64.yml`, `${channel}-win-arm64.yml`], `${channel}.yml`);
  }
}
