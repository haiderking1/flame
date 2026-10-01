export type ToastType = "loading" | "success" | "error" | "info";
export type Toast = {
  id: string;
  // Toasts with a scope only show while that project is active; null shows everywhere.
  scope: string | null;
  type: ToastType;
  title: string;
  description: string | null;
  // When set and there is no description, the toast shows "Running for …" counted from this time.
  since?: number | null;
  action?: { label: string; run(): void } | null;
  // Error text offered through a copy button.
  copy?: string | null;
  // Closes after this much time with the window visible and focused; omitted toasts stay until dismissed.
  dismissAfterVisibleMs?: number;
  createdAt: number;
};
type Listener = () => void;
const MAX_TOASTS = 3;
/** Global toast list: newest first, capped, with stable identities so unchanged toasts do not re-render. */
export function createToastStore() {
  let toasts: readonly Toast[] = [];
  const listeners = new Set<Listener>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    snapshot: () => toasts,
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Adds a toast or replaces the one with the same id, keeping its position and creation time. */
    show(toast: Omit<Toast, "createdAt"> & { createdAt?: number }) {
      const index = toasts.findIndex(item => item.id === toast.id);
      if (index >= 0) {
        const next = { ...toast, createdAt: toasts[index]!.createdAt };
        toasts = toasts.map((item, i) => i === index ? next : item);
      } else toasts = [{ ...toast, createdAt: toast.createdAt ?? Date.now() }, ...toasts].slice(0, MAX_TOASTS);
      emit();
    },
    dismiss(id: string) {
      if (!toasts.some(item => item.id === id)) return;
      toasts = toasts.filter(item => item.id !== id); emit();
    },
    has: (id: string) => toasts.some(item => item.id === id),
  };
}
export const toastStore = createToastStore();
