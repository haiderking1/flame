import { useState } from "react";
import { Tooltip } from "../tooltip/Tooltip";
import { UpdateIcon } from "./UpdateIcon";
import { UpdateInstallDialog } from "./UpdateInstallDialog";
import { showsUpdateButton, updateTooltip } from "./updateText";
import type { useDesktopUpdate } from "./useDesktopUpdate";
import "./update-button.css";

/** The sidebar's update button: shown while an update is available, downloading, ready to install, or failed. */
export function UpdateButton({ updates }: { updates: ReturnType<typeof useDesktopUpdate> }) {
  const { state } = updates;
  const [confirming, setConfirming] = useState(false);
  if (!state || !showsUpdateButton(state)) return null;
  const label = updateTooltip(state);
  const click = () => {
    if (state.status === "available" || (state.status === "error" && state.errorContext === "download")) updates.download();
    else if (state.status === "downloaded" || (state.status === "error" && state.errorContext === "install")) setConfirming(true);
    else if (state.status === "error") updates.check();
  };
  return <>
    <Tooltip label={label} delay={150} className="update-button__anchor">
      <button type="button" className="update-button" data-status={state.status} aria-label={label} disabled={state.status === "downloading"} onClick={click}>
        <UpdateIcon status={state.status} percent={state.downloadPercent} />
      </button>
    </Tooltip>
    {confirming && state.downloadedVersion && <UpdateInstallDialog version={state.downloadedVersion} install={updates.install} onClose={() => setConfirming(false)} />}
  </>;
}
