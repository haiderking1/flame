import { useEffect, useState } from "react";
import type { SessionLocation } from "@contracts/sessions";
import type { DraftImage } from "../images/draft-storage";

export type PendingImageMessage = { id: string; scope: string; text: string; images: readonly DraftImage[]; sending: boolean };
export function usePendingImageMessage(location?: SessionLocation) {
  const scope = location ? `${location.projectId}:${location.sessionId}` : "";
  const [message, setMessage] = useState<PendingImageMessage | null>(null);
  useEffect(() => { setMessage(current => current?.scope === scope ? current : null); }, [scope]);
  return {
    message: message?.scope === scope ? message : null,
    begin(text: string, images: readonly DraftImage[]) {
      if (!scope || !images.length) return undefined;
      const next = { id: crypto.randomUUID(), scope, text, images: [...images], sending: true };
      setMessage(next);
      return (accepted: boolean) => setMessage(current => current?.id === next.id
        ? accepted ? { ...current, sending: false } : null : current);
    },
  };
}
