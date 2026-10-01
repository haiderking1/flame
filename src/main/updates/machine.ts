import type { UpdateChannel, UpdateErrorContext, UpdateState } from "../../contracts/desktop-update.js";

const RELEASES = "https://github.com/haiderking1/flame/releases/tag/v";
const releaseUrl = (version: string) => `${RELEASES}${encodeURIComponent(version)}`;

/** The state before any check: disabled builds say why and never change. */
export function initialState(input: { version: string; channel: UpdateChannel; disabledReason: string | null; translated: boolean }): UpdateState {
  return { enabled: input.disabledReason === null, status: input.disabledReason ? "disabled" : "idle", channel: input.channel, currentVersion: input.version,
    availableVersion: null, downloadedVersion: null, downloadPercent: null, checkedAt: null, message: input.disabledReason, errorContext: null,
    canRetry: false, releaseUrl: null, translated: input.translated };
}

// Transitions for what the updater reports. A downloaded update stays ready to install whatever later checks find.
export const checking = (state: UpdateState): UpdateState => state.status === "downloaded" || state.status === "downloading" ? state
  : { ...state, status: "checking", message: null, errorContext: null, canRetry: false };
export const available = (state: UpdateState, version: string, now: number): UpdateState => state.status === "downloaded" && state.downloadedVersion === version
  ? { ...state, checkedAt: now }
  : { ...state, status: "available", availableVersion: version, downloadPercent: null, checkedAt: now, message: null, errorContext: null, canRetry: false, releaseUrl: releaseUrl(version) };
export const upToDate = (state: UpdateState, now: number): UpdateState => state.status === "downloaded" ? { ...state, checkedAt: now }
  : { ...state, status: "up-to-date", availableVersion: null, downloadPercent: null, checkedAt: now, message: null, errorContext: null, canRetry: false, releaseUrl: null };
export const downloading = (state: UpdateState, percent: number): UpdateState =>
  ({ ...state, status: "downloading", downloadPercent: Math.max(0, Math.min(100, Math.floor(percent))), message: null, errorContext: null, canRetry: false });
export const downloaded = (state: UpdateState, version: string): UpdateState =>
  ({ ...state, status: "downloaded", availableVersion: version, downloadedVersion: version, downloadPercent: 100, message: null, errorContext: null, canRetry: false, releaseUrl: releaseUrl(version) });
/**
 * A failure says which step failed; checks and downloads can be retried, and a failed install can be tried again. A
 * background check that fails never takes away an update that is downloading or ready to install.
 */
export const failed = (state: UpdateState, context: UpdateErrorContext, message: string): UpdateState =>
  context === "check" && (state.status === "downloaded" || state.status === "downloading") ? state
    : { ...state, status: "error", downloadPercent: null, message, errorContext: context, canRetry: true };
/** A new track forgets what the old one offered, except an update already downloaded. */
export const switched = (state: UpdateState, channel: UpdateChannel): UpdateState => state.status === "downloaded" ? { ...state, channel }
  : { ...state, channel, status: state.enabled ? "idle" : "disabled", availableVersion: null, downloadPercent: null, message: state.enabled ? null : state.message,
    errorContext: null, canRetry: false, releaseUrl: null };

/** Download progress is announced in 10% steps, so the renderer is not flooded. */
export const progressStep = (previous: number | null, next: number) => previous === null || Math.floor(next / 10) > Math.floor(previous / 10) || next >= 100;

/** A short, user-facing reason from an updater error; never a stack or a URL with tokens. */
export function updateErrorMessage(error: unknown, context: UpdateErrorContext): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const lead = { check: "Could not check for updates", download: "Could not download the update", install: "Could not install the update" }[context];
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|net::ERR_/i.test(text)) return `${lead}. Check your connection and try again.`;
  if (/\b(403|429)\b|rate limit/i.test(text)) return `${lead}. GitHub is limiting requests right now; try again later.`;
  if (/\b404\b|Cannot find .*\.yml|No published versions/i.test(text)) return `${lead}. No release was found for this update track.`;
  if (/sha512|checksum/i.test(text)) return `${lead}. The download was damaged; try again.`;
  return `${lead}.`;
}
