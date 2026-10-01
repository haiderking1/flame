import { GitError } from "../../contracts/git.js";
import type { SourceControlKind } from "../../contracts/source-control.js";
import { gitCommand } from "./command.js";
import { hostings, hostingFor } from "./hosting/index.js";

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; identity: { name: string; email: string } }>();
/**
 * Author and committer for a commit. When Git already knows who you are this is empty and Git's own configuration
 * applies. Otherwise the signed-in hosting account supplies a name and its private commit email, for this commit
 * only; nothing is written to Git configuration.
 */
export async function commitIdentity(root: string, provider: SourceControlKind | null, signal: AbortSignal): Promise<NodeJS.ProcessEnv> {
  const known = await gitCommand(root, ["var", "GIT_COMMITTER_IDENT"], { signal, allowed: [0, 128] });
  if (known.code === 0) return {};
  const preferred = hostingFor(provider), candidates = [...(preferred ? [preferred] : []), ...hostings.filter(hosting => hosting !== preferred)];
  for (const hosting of candidates) {
    const cached = cache.get(hosting.kind);
    let identity = cached && Date.now() - cached.at < CACHE_MS ? cached.identity : null;
    if (!identity) {
      try { identity = await hosting.identity(root, signal); cache.set(hosting.kind, { at: Date.now(), identity }); }
      catch (error) { if (signal.aborted) throw error; continue; }
    }
    return { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email };
  }
  throw new GitError({ code: "INVALID", message: "Git doesn't know who you are. Sign in with `gh auth login`, or run `git config --global user.name \"Your Name\"` and `git config --global user.email you@example.com`, then retry." });
}
/** Forgets cached accounts, for tests and after sign-in changes. */
export function clearIdentityCache() { cache.clear(); }
