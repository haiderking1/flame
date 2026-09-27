import { useEffect, useRef, type ReactNode } from "react";
import { SidebarToggle } from "./SidebarToggle";
import "./sidebar-drawer.css";

export function SidebarDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return (
    <dialog ref={ref} className="sidebar-drawer" aria-label="Sidebar"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sidebar-drawer__content">
        <SidebarToggle expanded={open} onToggle={onClose} />
        {children}
      </div>
    </dialog>
  );
}
