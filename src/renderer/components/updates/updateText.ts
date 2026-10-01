import type { UpdateState } from "@contracts/desktop-update";

/** What the sidebar's update button says on hover, for each state it shows in. */
export function updateTooltip(state: UpdateState): string {
  switch (state.status) {
    case "available": return `Update ${state.availableVersion} ready to download`;
    case "downloading": return `Downloading update (${state.downloadPercent ?? 0}%)`;
    case "downloaded": return `Update ${state.downloadedVersion} downloaded. Click to restart and install.`;
    case "error": return state.errorContext === "install" ? `Install failed for ${state.downloadedVersion}. Click to retry.`
      : state.errorContext === "download" ? `Download failed for ${state.availableVersion}. Click to retry.` : "Update check failed. Click to retry.";
    case "checking": return "Checking for updates…";
    case "up-to-date": return "Up to date";
    default: return "Check for updates";
  }
}
/** The sidebar shows the button only when there is something to do. */
export const showsUpdateButton = (state: UpdateState | null) => !!state?.enabled && ["available", "downloading", "downloaded", "error"].includes(state.status);
/** The About page's version button. */
export function updateButtonLabel(state: UpdateState): string {
  switch (state.status) {
    case "checking": return "Checking…";
    case "available": return "Download";
    case "downloading": return `Downloading… ${state.downloadPercent ?? 0}%`;
    case "downloaded": return "Install";
    case "up-to-date": return "Up to Date";
    case "error": return state.errorContext === "install" ? "Install" : state.errorContext === "download" ? "Download" : "Check for Updates";
    default: return "Check for Updates";
  }
}
/** What the version button does; null when it has nothing to do. */
export function updateButtonAction(state: UpdateState): "check" | "download" | "install" | null {
  if (!state.enabled || state.status === "checking" || state.status === "downloading") return null;
  if (state.status === "available" || (state.status === "error" && state.errorContext === "download")) return "download";
  if (state.status === "downloaded" || (state.status === "error" && state.errorContext === "install")) return "install";
  return "check";
}
