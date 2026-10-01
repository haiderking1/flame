import { useEffect, useState } from "react";
import type { UpdateChannel, UpdateState } from "@contracts/desktop-update";

/**
 * The app's update state from the main process, kept current; null outside the desktop app. Actions report failures
 * through the state itself, so callers need not catch.
 */
export function useDesktopUpdate() {
  const bridge = window.flame?.updates;
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const stop = bridge.onState(next => { if (live) setState(next); });
    void bridge.state().then(next => { if (live) setState(current => current ?? next); }, () => {});
    return () => { live = false; stop(); };
  }, [bridge]);
  const act = (step: () => Promise<unknown>) => { void step().catch(() => {}); };
  return {
    state,
    check: () => act(() => bridge!.check()),
    download: () => act(() => bridge!.download()),
    install: () => bridge!.install(),
    setChannel: (channel: UpdateChannel) => act(() => bridge!.setChannel(channel)),
  };
}
