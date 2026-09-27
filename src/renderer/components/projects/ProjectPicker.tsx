import { useEffect, useRef, useState } from "react";
import type { Project } from "@contracts/projects";
import { FolderBrowser } from "./FolderBrowser";
import { PickerIcon } from "./PickerIcon";
import { PickerFooter } from "./PickerFooter";
import "./project-picker.css";

export function ProjectPicker({ onClose, onAdded }: { onClose(): void; onAdded(project: Project): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const [search, setSearch] = useState("");
  const showLocalFolder = "local folder browse a folder on disk".includes(search.toLowerCase());
  useEffect(() => {
    const target = dialog.current;
    const previous = document.activeElement;
    target?.showModal();
    return () => { target?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="project-picker" aria-label="Add a project" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    onClose();
  }}>
    <button type="button" className="project-picker__close" aria-label="Close project picker" onClick={onClose}><PickerIcon name="close" /></button>
    <div className="project-picker__surface">{browsing ? <FolderBrowser onBack={() => setBrowsing(false)} onAdded={onAdded} /> : <section>
      <header className="project-picker__header">
        <button type="button" aria-label="Back" onClick={onClose}><PickerIcon name="back" /></button>
        <input autoFocus placeholder="Search..." aria-label="Search project sources" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && showLocalFolder) { event.preventDefault(); setBrowsing(true); }
          if (event.key === "Backspace" && !search) { event.preventDefault(); onClose(); }
        }} />
      </header>
      <div className="project-picker__body"><p className="project-picker__label">Sources</p>
        {showLocalFolder ? <button className="project-picker__source" type="button" onClick={() => setBrowsing(true)}><PickerIcon name="folder-plus" /><span><span>Local folder</span><small>Browse a folder on disk</small></span></button> : <p className="project-picker__empty">No matching sources.</p>}
      </div>
      <PickerFooter />
    </section>}</div>
  </dialog>;
}
