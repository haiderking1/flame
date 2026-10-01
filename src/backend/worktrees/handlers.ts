import { Cause, Effect, Queue, Stream } from "effect";
import { SessionError } from "../../contracts/sessions.js";
import { WorktreeError, WorktreeRpc, type WorktreeSettings } from "../../contracts/worktrees.js";
import type { WorktreeSetupSnapshot } from "../../contracts/worktree-setup.js";
import { storageError } from "../sessions/files.js";
import { asWorktreeError } from "./errors.js";
import type { Worktrees } from "./service.js";
import { setupKey } from "./setup-tracker.js";

const failure = (error: unknown) => error instanceof WorktreeError ? error : asWorktreeError(error, "Worktree settings could not be read or saved. Check disk space and permissions.");
const sessionFailure = (error: unknown) => error instanceof SessionError || error instanceof WorktreeError ? error : storageError();
export function worktreeHandlers(worktrees: Worktrees) {
  return WorktreeRpc.toLayer({
    "worktrees.settings": () => Stream.callback<WorktreeSettings, WorktreeError>(queue => Effect.acquireRelease(Effect.sync(() => {
      const publish = () => { try { Queue.offerUnsafe(queue, worktrees.settings()); } catch (error) { Queue.failCauseUnsafe(queue, Cause.fail(failure(error))); } };
      worktrees.on("settings", publish); publish();
      return () => { worktrees.off("settings", publish); };
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
    "worktrees.saveDefaults": defaults => Effect.try({ try: () => worktrees.saveDefaults(defaults), catch: failure }).pipe(Effect.uninterruptible),
    "worktrees.saveProject": project => Effect.try({ try: () => worktrees.saveProject(project), catch: failure }).pipe(Effect.uninterruptible),
    "worktrees.configure": ({ workspace, revision, ...location }) => Effect.tryPromise({ try: () => worktrees.configure(location, revision, workspace), catch: sessionFailure }).pipe(Effect.uninterruptible),
    "worktrees.refs": ({ query, limit, ...target }) => Effect.tryPromise({ try: signal => worktrees.refs(target, query, limit, signal), catch: failure }),
    // A disconnect after acceptance must not leave a switch half done.
    "worktrees.switchRef": ({ ref, create, ...target }) => Effect.tryPromise({ try: () => worktrees.switchRef(target, ref, create), catch: failure }).pipe(Effect.uninterruptible),
    "worktrees.remove": ({ projectId, path }) => Effect.tryPromise({ try: () => worktrees.remove(projectId, path), catch: failure }).pipe(Effect.uninterruptible),
    "worktrees.setup": location => Stream.callback<WorktreeSetupSnapshot | null, WorktreeError>(queue => Effect.acquireRelease(Effect.sync(() => {
      const id = setupKey(location);
      const publish = (changed = id) => {
        if (changed !== id) return;
        try { Queue.offerUnsafe(queue, worktrees.setup(location)); } catch (error) { Queue.failCauseUnsafe(queue, Cause.fail(failure(error))); }
      };
      worktrees.tracker.on("change", publish); publish();
      return () => { worktrees.tracker.off("change", publish); };
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
    "worktrees.workLocally": location => Effect.try({ try: () => worktrees.workLocally(location), catch: failure }),
    "worktrees.resolvePullRequest": ({ projectId, reference }) => Effect.tryPromise({ try: signal => worktrees.resolvePullRequest(projectId, reference, signal), catch: failure }),
    "worktrees.preparePullRequest": ({ projectId, sessionId, reference, mode }) => Effect.tryPromise({
      try: () => worktrees.preparePullRequest({ projectId, reference, mode, session: sessionId ? { projectId, sessionId } : null }), catch: failure,
    }).pipe(Effect.uninterruptible),
  });
}
