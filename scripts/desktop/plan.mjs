import { releaseOf } from "./release.mjs";

/**
 * What a release workflow run builds and publishes:
 *  - a pushed tag vX.Y.Z is the stable release of package.json's version;
 *  - the schedule builds a nightly, X.Y.Z-nightly.YYYYMMDD.N, unless nothing changed since the last nightly;
 *  - a manual run builds a nightly, the stable release, or a preview, X.Y.Z-preview.<run>, which never publishes updates.
 * package.json's version is always the next stable release.
 */
export function planRelease({ event, ref = "", channel: requested = "preview", packageVersion, today, run, tags, head, lastNightlyCommit }) {
  const skip = reason => ({ publish: false, reason });
  const stable = () => {
    if (tags.includes(`v${packageVersion}`) && event !== "push") return skip(`v${packageVersion} is already released. Bump the version in package.json first.`);
    return release(packageVersion, false);
  };
  const nightly = () => {
    if (event === "schedule" && lastNightlyCommit === head) return skip("Nothing changed since the last nightly.");
    const prefix = `v${packageVersion}-nightly.${today}.`;
    const count = tags.filter(tag => tag.startsWith(prefix)).length;
    return release(`${packageVersion}-nightly.${today}.${count + 1}`, true);
  };
  if (event === "push") {
    const version = ref.replace(/^refs\/tags\/v/, "");
    if (version !== packageVersion) throw new Error(`Tag v${version} does not match package.json's version ${packageVersion}.`);
    return stable();
  }
  if (event === "schedule") return nightly();
  if (requested === "stable") return stable();
  if (requested === "nightly") return nightly();
  if (requested === "preview") return release(`${packageVersion}-preview.${run}`, true);
  throw new Error(`Unknown release channel "${requested}".`);
}

function release(version, prerelease) {
  const { channel } = releaseOf(version);
  return { publish: true, version, tag: `v${version}`, channel: channel ?? "preview", prerelease, makeLatest: !prerelease, updates: channel !== null };
}
