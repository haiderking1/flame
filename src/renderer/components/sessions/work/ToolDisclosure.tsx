import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
function createDisclosures() {
  const open = new Set<string>(), listeners = new Map<string, Set<() => void>>();
  return {
    get: (id: string) => open.has(id),
    set(id: string, value: boolean) { if (value === open.has(id)) return; if (value) open.add(id); else open.delete(id); for (const listener of listeners.get(id) ?? []) listener(); },
    subscribe(id: string, listener: () => void) { const own = listeners.get(id) ?? new Set(); own.add(listener); listeners.set(id, own); return () => { own.delete(listener); if (!own.size) listeners.delete(id); }; },
  };
}
const Context = createContext<ReturnType<typeof createDisclosures> | null>(null);
export function ToolDisclosures({ children }: { children: ReactNode }) {
  const store = useMemo(createDisclosures, []);
  return <Context value={store}>{children}</Context>;
}
export function useToolDisclosure(id: string): [boolean, (value: boolean) => void] {
  const store = useContext(Context), [local, setLocal] = useState(false);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(id, listener) ?? (() => {}), [store, id]);
  const snapshot = useCallback(() => store?.get(id) ?? local, [store, id, local]);
  const open = useSyncExternalStore(subscribe, snapshot, snapshot);
  return [open, value => { if (store) store.set(id, value); else setLocal(value); }];
}
