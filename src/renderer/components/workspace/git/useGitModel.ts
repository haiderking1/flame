import type { ModelSelection } from "@contracts/models";
import { useModelCatalog } from "../../composer/models/useModelCatalog";
import { useSessions } from "../../sessions/SessionContext";

/** The model the composer would use right now: the open session's, else the account default. Used to write Git text. */
export function useGitModel(): ModelSelection | null {
  const catalog = useModelCatalog(), sessions = useSessions();
  return sessions?.document ? sessions.document.settings : catalog.selection;
}
