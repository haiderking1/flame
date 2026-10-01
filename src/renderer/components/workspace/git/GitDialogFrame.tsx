import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WorkspaceIcon } from "../WorkspaceIcon";
import "./git-dialogs.css";

type Props = { title: string; description: ReactNode; className?: string; locked?: boolean; onClose(): void; children?: ReactNode; footer: ReactNode };
/** Modal frame shared by the Git dialogs: title, description, optional panel and footer, closing on Escape or a backdrop click. */
export function GitDialogFrame({ title, description, className, locked, onClose, children, footer }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useRef(`git-dialog-${crypto.randomUUID()}`).current;
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => { if (element.open) element.close(); }; }, []);
  return createPortal(<dialog ref={dialog} className={`git-dialog${className ? ` ${className}` : ""}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}
    onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && !locked && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose();
    }}>
    <header className="git-dialog__header">
      <h2 id={titleId}>{title}</h2>
      <p className="git-dialog__description">{description}</p>
      <button type="button" className="git-dialog__close" aria-label="Close" disabled={locked} onClick={onClose}><WorkspaceIcon name="close" /></button>
    </header>
    {children && <div className="git-dialog__panel">{children}</div>}
    <footer className="git-dialog__footer">{footer}</footer>
  </dialog>, document.body);
}
