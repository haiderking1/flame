import { Schema } from "effect";
import { SessionLocation } from "@contracts/sessions";
const key = "flame.sessions.active";
export function restoreActiveSession(): SessionLocation | null {
  try { const saved = localStorage.getItem(key); return saved ? Schema.decodeUnknownSync(SessionLocation)(JSON.parse(saved)) : null; }
  catch { return null; }
}
export function rememberActiveSession(location: SessionLocation | null) {
  try { if (location) localStorage.setItem(key, JSON.stringify({ projectId: location.projectId, sessionId: location.sessionId })); else localStorage.removeItem(key); }
  catch { /* Session data remains durable in SQLite even if this UI preference cannot be saved. */ }
}
