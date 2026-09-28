import { createContext, useContext, type ReactNode } from "react";
import { useProjectWorkspace } from "./useProjectWorkspace";
const Context = createContext<ReturnType<typeof useProjectWorkspace> | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const workspace = useProjectWorkspace();
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
export function useSessions() { return useContext(Context); }
