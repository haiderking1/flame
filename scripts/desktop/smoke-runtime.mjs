/**
 * Runs inside the packaged app as Node (ELECTRON_RUN_AS_NODE): loads Flame's backend modules from app.asar and uses the
 * parts that depend on packaging: the native file search, the image worker and SQLite. argv: <app.asar> <scratch dir>.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [asar, scratch] = process.argv.slice(2);
const project = join(scratch, "project");
mkdirSync(join(project, "src"), { recursive: true });
writeFileSync(join(project, "src", "flame-smoke.ts"), "export {};\n");

const { WorkspaceIndex } = await import(join(asar, "dist/backend/workspace-search/index.js"));
const index = WorkspaceIndex.open(project);
let found = "";
// The index scans in the background; a search before it is ready is refused.
for (let attempt = 0; attempt < 50 && !found.includes("flame-smoke.ts"); attempt++) {
  try { found = JSON.stringify(await index.search("flame-smoke", 5)); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
}
index.destroy();
assert.ok(found.includes("flame-smoke.ts"), "file search finds a file through the unpacked native library");

const { normalizeImage } = await import(join(asar, "dist/backend/images/normalize.js"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const prepared = await normalizeImage(new Uint8Array(png), new AbortController().signal);
assert.deepEqual([prepared.width, prepared.height], [1, 1], "the image worker runs from inside app.asar");

const db = new DatabaseSync(join(scratch, "smoke.sqlite"));
db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('ok')");
assert.equal(db.prepare("SELECT v FROM t").get().v, "ok");
db.close();
console.log("FLAME_PACKAGED_RUNTIME_OK");
