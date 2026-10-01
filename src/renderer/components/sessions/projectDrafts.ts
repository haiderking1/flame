import { Schema } from "effect";
import { fitsSessionText } from "@contracts/sessions";
import { SessionWorkspace } from "@contracts/session-workspace";

// `workspace` is where the new session will work, once chosen in the composer; absent follows the project's default.
export interface ProjectDraft { text: string; sessionId: string; requestId: string; submittedText: string | null; workspace?: SessionWorkspace }
const validWorkspace = (value: unknown) => value === undefined || Schema.is(SessionWorkspace)(value);
const prefix = "flame.projectDraft.";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function readProjectDraft(projectId: string): ProjectDraft {
  const raw = localStorage.getItem(prefix + projectId);
  if (raw) {
    const value = JSON.parse(raw) as ProjectDraft;
    if (!value || typeof value.text !== "string" || !fitsSessionText(value.text) || !uuid.test(value.sessionId) || !uuid.test(value.requestId)
      || !(value.submittedText === null || typeof value.submittedText === "string" && fitsSessionText(value.submittedText)) || !validWorkspace(value.workspace)) throw new Error("The saved project draft could not be read. It has not been overwritten.");
    return value;
  }
  return { text: "", sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), submittedText: null };
}
export function saveProjectDraft(projectId: string, value: ProjectDraft) {
  if (!fitsSessionText(value.text)) throw new Error("Draft exceeds the 48 KiB encoded message limit. Shorten it before sending.");
  try { localStorage.setItem(prefix + projectId, JSON.stringify(value)); }
  catch { throw new Error("The project draft could not be saved. Free some storage and try again; no new message was sent."); }
}
export function removeProjectDraft(projectId: string) { localStorage.removeItem(prefix + projectId); }
