import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";
import { toastStore, type Toast } from "./toastStore";
import "./toasts.css";

const PEEK = 12, GAP = 12;
function elapsed(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return seconds < 60 ? `Running for ${seconds}s` : `Running for ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
/** Whether the window is visible and focused; dismissal countdowns only run while it is. */
function useWindowAttention() {
  const [attentive, setAttentive] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  useEffect(() => {
    const update = () => setAttentive(document.visibilityState === "visible" && document.hasFocus());
    window.addEventListener("focus", update); window.addEventListener("blur", update); document.addEventListener("visibilitychange", update);
    return () => { window.removeEventListener("focus", update); window.removeEventListener("blur", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return attentive;
}
function ToastCard({ toast, index, offset, expanded, onHeight, paused }: { toast: Toast; index: number; offset: number; expanded: boolean; onHeight(id: string, height: number): void; paused: boolean }) {
  const card = useRef<HTMLLIElement>(null), [now, setNow] = useState(Date.now), [copied, setCopied] = useState(false);
  const remaining = useRef(toast.dismissAfterVisibleMs ?? 0);
  useLayoutEffect(() => {
    const element = card.current!; onHeight(toast.id, element.offsetHeight);
    const observer = new ResizeObserver(() => onHeight(toast.id, element.offsetHeight)); observer.observe(element);
    return () => observer.disconnect();
  }, [toast.id, onHeight]);
  useEffect(() => {
    if (!toast.since || toast.description) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [toast.since, toast.description]);
  useEffect(() => { remaining.current = toast.dismissAfterVisibleMs ?? 0; }, [toast.dismissAfterVisibleMs, toast.title]);
  useEffect(() => {
    if (!toast.dismissAfterVisibleMs || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => toastStore.dismiss(toast.id), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [toast.id, toast.dismissAfterVisibleMs, toast.title, paused]);
  const description = toast.description ?? (toast.since ? elapsed(toast.since, now) : null);
  const icon = toast.type === "loading" ? <WorkspaceIcon name="loader" className="toast__icon toast__icon--spin" />
    : <WorkspaceIcon name={toast.type === "success" ? "circle-check" : toast.type === "error" ? "circle-alert" : "info"} className={`toast__icon toast__icon--${toast.type}`} />;
  const transform = expanded ? `translateY(${offset}px)` : `translateY(${index * PEEK}px) scale(${1 - index * 0.1})`;
  return <li ref={card} className="toast" data-type={toast.type} data-front={index === 0 || expanded || undefined} style={{ transform, zIndex: 10 - index }}
    role={toast.type === "error" ? "alert" : "status"} aria-live={toast.type === "error" ? "assertive" : "polite"}>
    <div className={`toast__content${toast.action ? " toast__content--stacked" : ""}`}>
      <div className="toast__body">
        <div className="toast__title">{icon}<strong>{toast.title}</strong></div>
        {description && <p className={`toast__description${toast.type === "error" && description.length >= 180 ? " toast__description--clamped" : ""}`}>{description}</p>}
      </div>
      {toast.copy && <button type="button" className="toast__copy" aria-label={copied ? "Copied error" : "Copy error"} title={copied ? "Copied error" : "Copy error"}
        onClick={() => { void navigator.clipboard.writeText(toast.copy!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
        <WorkspaceIcon name={copied ? "check" : "copy"} /></button>}
      {toast.action && <div className="toast__actions"><button type="button" className="toast__action" onClick={() => { toastStore.dismiss(toast.id); toast.action!.run(); }}>{toast.action.label}</button></div>}
    </div>
    <button type="button" className="toast__dismiss" aria-label="Dismiss notification" onClick={() => toastStore.dismiss(toast.id)}><WorkspaceIcon name="close" /></button>
  </li>;
}
/** Top-right notification stack: collapsed with a peek of older toasts, expanded while hovered or focused. */
export function ToastViewport({ scope }: { scope: string | null }) {
  const all = useSyncExternalStore(toastStore.subscribe, toastStore.snapshot);
  const toasts = all.filter(toast => toast.scope === null || toast.scope === scope);
  const [heights, setHeights] = useState<Record<string, number>>({}), [hovered, setHovered] = useState(false);
  const attentive = useWindowAttention();
  const measure = useRef((id: string, height: number) => setHeights(current => current[id] === height ? current : { ...current, [id]: height })).current;
  const expanded = hovered && toasts.length > 1;
  const offsets: number[] = []; let total = 0;
  for (const toast of toasts) { offsets.push(total); total += (heights[toast.id] ?? 0) + GAP; }
  const height = toasts.length ? expanded ? total - GAP : (heights[toasts[0]!.id] ?? 0) + (toasts.length - 1) * PEEK : 0;
  return <section className="toast-viewport" aria-label="Notifications" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setHovered(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false); }}>
    <ol style={{ height }}>{toasts.map((toast, index) => <ToastCard key={toast.id} toast={toast} index={index} offset={offsets[index]!} expanded={expanded} onHeight={measure} paused={!attentive || hovered} />)}</ol>
  </section>;
}
