import type { GitPullRequest, GitStatus } from "../../contracts/git.js";
import { gitCommand } from "./command.js";
import { PRIMARY_REMOTE } from "./branch-state.js";
import { headContext } from "./head-context.js";
import { hostingFor } from "./hosting/index.js";

const FETCH_STALE_MS = 15_000, FETCH_TIMEOUT_MS = 15_000;
const PR_OPEN_TTL_MS = 60_000, PR_OTHER_TTL_MS = 5 * 60_000;
const backoff = (base: number, failures: number) => Math.min(15 * 60_000, base * 2 ** Math.max(0, failures - 1));
type Fetch = { at: number; failures: number; retryAt: number; running: boolean };
type Lookup = { key: string; value: GitPullRequest | null; expires: number; failures: number; running: boolean };

/** The remote a status refresh should fetch: the upstream's remote (longest matching name), else origin. */
export function upstreamRemote(status: Pick<GitStatus, "upstream" | "remotes" | "hasPrimaryRemote">) {
  if (status.upstream) {
    const remote = [...status.remotes].sort((a, b) => b.length - a.length).find(name => status.upstream!.startsWith(`${name}/`));
    if (remote) return remote;
  }
  return status.hasPrimaryRemote ? PRIMARY_REMOTE : null;
}
/**
 * Keeps remote-derived status fresh without slowing status reads: tracking refs are fetched in the background
 * at most every 15s, and change requests are looked up through the hosting CLI with a TTL. Both back off on failure
 * and announce a change only when what they learned differs, so clients recheck at most once per real update.
 */
export class RemoteStatus {
  private readonly fetches = new Map<string, Fetch>();
  private readonly lookups = new Map<string, Lookup>();
  private readonly epochs = new Map<string, number>();
  private readonly controller = new AbortController();
  constructor(private readonly changed: (root: string) => void, private readonly busy: (root: string) => boolean, private readonly now: () => number = Date.now) {}
  /** Attaches the cached change request and schedules any refresh that is due; changes are announced for `workspace`. */
  attach(status: GitStatus, workspace: string): GitStatus {
    if (!status.repository || !status.root) return status;
    this.scheduleFetch(status, workspace);
    return { ...status, pr: this.lookup(status, workspace) };
  }
  /** Forgets cached remote knowledge after an action changed the branch, upstream or change requests. */
  invalidate(root: string) {
    this.epochs.set(root, (this.epochs.get(root) ?? 0) + 1);
    const fetch = this.fetches.get(root); if (fetch) fetch.at = 0;
  }
  close() { this.controller.abort(); }
  private scheduleFetch(status: GitStatus, workspace: string) {
    const root = status.root!, remote = upstreamRemote(status), now = this.now();
    if (!remote || this.busy(root)) return;
    const state = this.fetches.get(root) ?? { at: 0, failures: 0, retryAt: 0, running: false };
    this.fetches.set(root, state);
    if (state.running || now - state.at < FETCH_STALE_MS || now < state.retryAt) return;
    state.running = true;
    void this.fetch(root, remote).then(updated => {
      state.at = this.now(); state.failures = 0; state.retryAt = 0;
      if (updated) this.changed(workspace);
    }, () => { state.failures++; state.at = this.now(); state.retryAt = this.now() + backoff(30_000, state.failures); })
      .finally(() => { state.running = false; });
  }
  private async fetch(root: string, remote: string) {
    const refs = () => gitCommand(root, ["for-each-ref", "--format=%(refname) %(objectname)", `refs/remotes/${remote}`], { signal: this.controller.signal }).then(result => result.stdout.toString("utf8"));
    const before = await refs();
    await gitCommand(root, ["fetch", "--quiet", "--no-tags", "--no-auto-gc", "--no-write-fetch-head", "--recurse-submodules=no", remote],
      { signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]), timeout: FETCH_TIMEOUT_MS });
    return before !== await refs();
  }
  private lookup(status: GitStatus, workspace: string): GitPullRequest | null {
    const root = status.root!, hosting = hostingFor(status.provider?.kind), branch = status.branch;
    if (!hosting || !branch) return null;
    const wanted = status.isDefaultBranch ? "open" : "all";
    const key = `${branch}\0${status.upstream ?? ""}\0${wanted}\0${this.epochs.get(root) ?? 0}`;
    const cached = this.lookups.get(root);
    const sameBranch = cached?.key.split("\0")[0] === branch;
    const value = sameBranch ? cached!.value : null;
    if (cached?.running || (cached?.key === key && this.now() < cached.expires)) return value;
    // Without a remote to push to there can be no change request; skip the network call.
    if (!status.upstream && !status.hasPrimaryRemote) return null;
    const entry: Lookup = { key, value, expires: 0, failures: sameBranch ? cached!.failures : 0, running: true };
    this.lookups.set(root, entry);
    void headContext(root, branch, status.upstream, this.controller.signal)
      .then(head => hosting.changeRequests(root, head, wanted, this.controller.signal))
      .then(found => {
        const next = found[0] ?? null;
        entry.failures = 0; entry.expires = this.now() + (next?.state === "open" ? PR_OPEN_TTL_MS : PR_OTHER_TTL_MS);
        const different = JSON.stringify(next) !== JSON.stringify(entry.value);
        entry.value = next;
        if (different) this.changed(workspace);
      }, () => { entry.failures++; entry.expires = this.now() + backoff(20_000, entry.failures); })
      .finally(() => { entry.running = false; });
    return value;
  }
}
