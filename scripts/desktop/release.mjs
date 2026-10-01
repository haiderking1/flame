/** Release identity: the version being built and the update channel it belongs to. */
const VERSION = /^\d+\.\d+\.\d+(?:-(?:nightly\.\d{8}\.\d+|[0-9A-Za-z.-]+))?$/;

/**
 * The channel a version updates through: stable releases ("latest"), nightlies ("nightly", from
 * `X.Y.Z-nightly.YYYYMMDD.N`), or none for any other prerelease, which is built but never published for updates.
 */
export function releaseOf(version) {
  if (!VERSION.test(version)) throw new Error(`Invalid version "${version}". Use X.Y.Z or X.Y.Z-nightly.YYYYMMDD.N.`);
  const nightly = /-nightly\.\d{8}\.\d+$/.test(version);
  const channel = nightly ? "nightly" : version.includes("-") ? null : "latest";
  // A nightly installs beside the stable app: its own name, executable and launcher entry.
  return { version, channel, productName: nightly ? "Flame (Nightly)" : "Flame", executable: nightly ? "flame-nightly" : "flame" };
}
