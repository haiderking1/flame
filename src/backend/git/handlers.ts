import { Cause, Effect, Queue, Stream } from "effect";
import { GitError, GitRpc, type GitOperation } from "../../contracts/git.js";
import type { GitRuntime } from "./runtime.js";
import type { WorkspaceChanges } from "./changes.js";
const failure = (error: unknown) => error instanceof GitError ? error : new GitError({ code: "STORAGE", message: "Git state could not be read or saved. Check project access, disk space and permissions." });
export function gitHandlers(git: GitRuntime, changes: WorkspaceChanges) {
  return GitRpc.toLayer({
    "git.status": input => Effect.tryPromise({ try: signal => git.status(input.projectId, signal), catch: failure }),
    "git.file": input => Effect.tryPromise({ try: signal => git.file(input, signal), catch: failure }),
    // A disconnect after acceptance must not cancel or replay a mutation.
    "git.start": input => Effect.tryPromise({ try: () => git.start(input), catch: failure }).pipe(Effect.uninterruptible),
    "git.hosting": () => Effect.tryPromise({ try: signal => git.hosting(signal), catch: failure }),
    "git.open": input => Effect.tryPromise({ try: () => git.open(input.projectId, input.path), catch: failure }),
    "git.watch": ({ projectId }) => Stream.callback<readonly GitOperation[], GitError>(queue => Effect.acquireRelease(Effect.sync(() => {
      const publish = (changed = projectId) => {
        if (changed !== projectId) return;
        try { Queue.offerUnsafe(queue, git.list(projectId)); } catch (error) { Queue.failCauseUnsafe(queue, Cause.fail(failure(error))); }
      };
      git.on("change", publish); publish(); return () => git.off("change", publish);
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
    "git.changes": ({ projectId }) => Stream.callback<number>(queue => Effect.acquireRelease(Effect.sync(() => {
      const publish = (changed: string, revision: number) => { if (changed === projectId) Queue.offerUnsafe(queue, revision); };
      changes.on("change", publish); Queue.offerUnsafe(queue, changes.revision(projectId)); return () => changes.off("change", publish);
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
  });
}
