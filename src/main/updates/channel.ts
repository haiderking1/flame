import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isUpdateChannel, type UpdateChannel } from "../../contracts/desktop-update.js";

const NIGHTLY = /^[^-+]+-nightly\.\d{8}\.\d+$/;
/** The channel a version belongs to: X.Y.Z-nightly.YYYYMMDD.N is a nightly, anything else follows stable releases. */
export const channelOf = (version: string): UpdateChannel => NIGHTLY.test(version) ? "nightly" : "latest";

/** The update track the user picked, kept in the app's data folder; until they pick one, the build's own channel. */
export class ChannelSetting {
  private readonly file: string;
  constructor(directory: string, private readonly version: string) { this.file = join(directory, "update-settings.json"); }
  async load(): Promise<UpdateChannel> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, "utf8"));
      const channel = saved !== null && typeof saved === "object" ? (saved as { channel?: unknown }).channel : undefined;
      if (isUpdateChannel(channel)) return channel;
    } catch { /* Not chosen yet, or unreadable: the build's channel. */ }
    return channelOf(this.version);
  }
  async save(channel: UpdateChannel) {
    await writeFile(this.file, `${JSON.stringify({ channel })}\n`, { mode: 0o600 });
  }
}
