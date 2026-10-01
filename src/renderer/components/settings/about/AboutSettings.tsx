import { useState } from "react";
import type { UpdateChannel, UpdateState } from "@contracts/desktop-update";
import { Choice, SettingsRow } from "../SettingsControls";
import { useDesktopUpdate } from "../../updates/useDesktopUpdate";
import { UpdateInstallDialog } from "../../updates/UpdateInstallDialog";
import { updateButtonAction, updateButtonLabel } from "../../updates/updateText";
import "./about-settings.css";

const TRACKS = [["latest", "Stable"], ["nightly", "Nightly"]] as const;

function versionStatus(state: UpdateState, now: number) {
  if (!state.enabled) return state.message;
  if (state.status === "error") return state.message;
  if (state.status === "available") return `Flame ${state.availableVersion} is available.`;
  if (state.status === "downloading") return `Downloading Flame ${state.availableVersion}.`;
  if (state.status === "downloaded") return `Flame ${state.downloadedVersion} is ready to install.`;
  if (state.checkedAt) {
    const minutes = Math.round((now - state.checkedAt) / 60_000);
    return `Up to date. Checked ${minutes < 1 ? "just now" : minutes === 1 ? "a minute ago" : `${minutes} minutes ago`}.`;
  }
  return null;
}

/** Settings → About: the version, its updates, and the update track. */
export function AboutSettings() {
  const updates = useDesktopUpdate();
  const { state } = updates;
  const [confirming, setConfirming] = useState(false);
  if (!state) return <section className="git-settings" aria-labelledby="about-heading"><h1 id="about-heading">About</h1>
    <p className="about-settings__note">Updates are managed by the Flame desktop app.</p></section>;
  const action = updateButtonAction(state);
  const status = versionStatus(state, Date.now());
  const run = () => { if (action === "check") updates.check(); else if (action === "download") updates.download(); else if (action === "install") setConfirming(true); };
  return <section className="git-settings" aria-labelledby="about-heading">
    <h1 id="about-heading">About</h1>
    <div className="git-settings__list">
      <SettingsRow id="about-version" title="Version" description={<>
        <span className="about-settings__version">Flame {state.currentVersion}</span>
        {status && <span className="about-settings__status" data-status={state.status} role="status">{status}</span>}
        {state.releaseUrl && <a className="about-settings__link" href={state.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>}
      </>}>
        <button type="button" className="about-settings__button" data-primary={action === "download" || action === "install" || undefined}
          disabled={!action} onClick={run}>{updateButtonLabel(state)}</button>
      </SettingsRow>
      <SettingsRow id="about-track" title="Update track" description="Use stable releases or nightly builds. Switch back anytime.">
        <Choice<UpdateChannel> label="Update track" value={state.channel} options={TRACKS} disabled={!state.enabled} onChange={updates.setChannel} />
      </SettingsRow>
    </div>
    {state.translated && <p className="about-settings__note" role="note">This is the Intel build of Flame running on Apple silicon. Download the Apple silicon build from the release page for better performance.</p>}
    {confirming && state.downloadedVersion && <UpdateInstallDialog version={state.downloadedVersion} install={updates.install} onClose={() => setConfirming(false)} />}
  </section>;
}
