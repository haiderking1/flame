import { parseDiffFromFile } from "@pierre/diffs";
self.onmessage = (event: MessageEvent<{ id: number; path: string; beforePath: string; before: string; after: string; version: string }>) => {
  const { id, path, beforePath, before, after, version } = event.data;
  try {
    const diff = parseDiffFromFile({ name: beforePath, contents: before }, { name: path, contents: after });
    diff.cacheKey = `${beforePath}\0${path}\0${version}:diff`;
    self.postMessage({ id, diff });
  } catch { self.postMessage({ id, error: "The diff is too expensive to compute safely. Switch to File to inspect the complete source." }); }
};
