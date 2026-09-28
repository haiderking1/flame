import { createContext, useContext, type ReactNode } from "react";
import { useSessionWorkspace } from "./useSessionWorkspace";
const Context = createContext<ReturnType<typeof useSessionWorkspace> | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const workspace = useSessionWorkspace();
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
export function useSessions() { return useContext(Context); }
