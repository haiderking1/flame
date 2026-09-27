export function PickerIcon({ name }: { name: "folder" | "folder-plus" | "back" | "up" | "down" | "close" }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(name === "folder" || name === "folder-plus") && <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />}
    {name === "folder-plus" && <path d="M12 10v6m-3-3h6" />}
    {name === "back" && <path d="m12 19-7-7 7-7m-7 7h14" />}
    {name === "up" && <path d="m5 12 7-7 7 7m-7 7V5" />}
    {name === "down" && <path d="m5 12 7 7 7-7M12 5v14" />}
    {name === "close" && <path d="m18 6-12 12M6 6l12 12" />}
  </svg>;
}
