import type { UpdateStatus } from "@contracts/desktop-update";

/** The update button's icon: an arrow to download, a ring filling while it downloads, a restart arrow once ready. */
export function UpdateIcon({ status, percent }: { status: UpdateStatus; percent: number | null }) {
  const ring = 2 * Math.PI * 9;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {status === "downloading" ? <>
      <circle cx="12" cy="12" r="9" opacity=".25" />
      <circle cx="12" cy="12" r="9" strokeDasharray={ring} strokeDashoffset={ring * (1 - (percent ?? 0) / 100)} transform="rotate(-90 12 12)" />
    </> : status === "downloaded" ? <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
      : status === "error" ? <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></>
      : <><circle cx="12" cy="12" r="9" /><path d="M12 7v9M8.5 12.5 12 16l3.5-3.5" /></>}
  </svg>;
}
