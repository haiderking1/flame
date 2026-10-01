import type { SessionPage } from "@contracts/sessions";
/** Retain loaded history only when the new page proves it is on the same chain. */
export function mergeLatestPage(previous: SessionPage, latest: SessionPage): SessionPage {
  const first = latest.entries[0];
  if (!first || !previous.entries.length) return latest;
  let start = previous.entries.findIndex(entry => entry.id === first.id);
  if (start < 0 && first.parentId) {
    const parent = previous.entries.findIndex(entry => entry.id === first.parentId);
    if (parent >= 0) start = parent + 1;
  }
  if (start < 0) return latest;
  const existing = new Map(previous.entries.map(entry => [entry.id, entry]));
  return { entries: [...previous.entries.slice(0, start), ...latest.entries.map(entry => existing.get(entry.id) ?? entry)], nextBefore: previous.nextBefore,
    compactions: [...new Map([...(previous.compactions ?? []), ...(latest.compactions ?? [])].map(marker => [marker.id, marker])).values()] };
}
export function prependPage(previous: SessionPage, older: SessionPage, cursor: string): SessionPage {
  if (previous.nextBefore !== cursor) return previous;
  return { entries: [...new Map([...older.entries, ...previous.entries].map(entry => [entry.id, entry])).values()], nextBefore: older.nextBefore,
    compactions: [...new Map([...(older.compactions ?? []), ...(previous.compactions ?? [])].map(marker => [marker.id, marker])).values()] };
}
