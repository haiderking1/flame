import { Schema } from "effect";
import { GitOperation } from "../../contracts/git.js";

const legacyActions = new Set(["init", "commit", "commit_push", "push"]);
/** Converts a version 1 operation (staging scope, remote, branch, upstream flag) to the version 2 shape; history is kept. */
export function upgradeOperation(raw: Record<string, unknown>): GitOperation {
  const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const text = (value: unknown) => typeof value === "string" ? value : null;
  const updatedAt = number(raw.updatedAt, Date.now());
  const commit = text(raw.commit);
  return Schema.decodeUnknownSync(GitOperation)({
    projectId: raw.projectId, requestId: raw.requestId, action: legacyActions.has(String(raw.action)) ? raw.action : "commit",
    message: (text(raw.message) ?? "").slice(0, 10_000), filePaths: null, featureBranch: false,
    expectedBranch: raw.action === "init" ? null : text(raw.branch)?.slice(0, 256) ?? null, model: null, publish: null,
    state: raw.state === "completed" || raw.state === "failed" ? raw.state : "interrupted", phase: text(raw.phase) ?? "", phases: [],
    phaseStartedAt: updatedAt, hook: null, detail: text(raw.detail), commit, result: null, createdAt: number(raw.createdAt, updatedAt), updatedAt,
  });
}
