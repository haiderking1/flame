/** Desktop app updates, shared between the main process and the renderer over IPC. */

/** Where updates come from: stable releases, or nightly builds. */
export type UpdateChannel = "latest" | "nightly";
export type UpdateStatus = "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
/** Which step failed, so the retry repeats it. */
export type UpdateErrorContext = "check" | "download" | "install";

export type UpdateState = {
  /** False for builds that cannot update themselves; `message` says why. */
  enabled: boolean;
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  /** 0–100 while downloading. */
  downloadPercent: number | null;
  checkedAt: number | null;
  message: string | null;
  errorContext: UpdateErrorContext | null;
  canRetry: boolean;
  /** The GitHub release page of the available or downloaded version. */
  releaseUrl: string | null;
  /** An Intel build running on Apple silicon through Rosetta. */
  translated: boolean;
};

export const UPDATE_CHANNELS: readonly UpdateChannel[] = ["latest", "nightly"];
export const isUpdateChannel = (value: unknown): value is UpdateChannel => value === "latest" || value === "nightly";
