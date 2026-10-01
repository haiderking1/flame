import { createContext, useContext, type RefObject } from "react";
export const HistoryScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(null);
export const useHistoryContainer = () => useContext(HistoryScrollContext);
