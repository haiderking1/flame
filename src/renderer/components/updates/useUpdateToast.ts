import { useEffect, useRef } from "react";
import type { UpdateState } from "@contracts/desktop-update";
import { toastStore } from "../toasts/toastStore";

/** Says once per version that an update finished downloading and where to install it. */
export function useUpdateToast(state: UpdateState | null) {
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (state?.status !== "downloaded" || !state.downloadedVersion || announced.current === state.downloadedVersion) return;
    announced.current = state.downloadedVersion;
    const releaseUrl = state.releaseUrl;
    toastStore.show({ id: "desktop-update", scope: null, type: "info", title: `Flame ${state.downloadedVersion} downloaded`,
      description: "Restart Flame from the update button to install it.",
      action: releaseUrl ? { label: "Release notes", run: () => { window.open(releaseUrl, "_blank", "noopener"); } } : null });
  }, [state?.status, state?.downloadedVersion]);
}
