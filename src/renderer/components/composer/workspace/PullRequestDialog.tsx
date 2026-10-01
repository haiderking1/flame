import { useEffect, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SourceControlProvider } from "@contracts/source-control";
import { changeRequestTerminology } from "@contracts/source-control";
import type { ResolvedPullRequest } from "@contracts/worktrees";
import { resolvePullRequest, worktreeErrorMessage } from "../../../backend/worktrees";
import { GitDialogFrame } from "../../workspace/git/GitDialogFrame";
import "./pull-request-dialog.css";

const RESOLVE_DELAY_MS = 300;
/**
 * T3 Code's "Checkout pull request" dialog: resolve a pull or merge request from its URL, checkout command or number,
 * then check it out in the project checkout ("Local") or a dedicated worktree ("Worktree", the default for Enter).
 */
export function PullRequestDialog({ projectId, provider, initial, onClose, onCheckout }: {
  projectId: string; provider: SourceControlProvider | null; initial: string; onClose(): void;
  onCheckout(reference: string, mode: "local" | "worktree"): Promise<void>;
}) {
  const resolve = useAtomSet(resolvePullRequest, { mode: "promise" });
  const terminology = changeRequestTerminology(provider?.kind);
  const [reference, setReference] = useState(initial), [resolved, setResolved] = useState<ResolvedPullRequest | null>(null);
  const [resolving, setResolving] = useState(false), [preparing, setPreparing] = useState<"local" | "worktree" | null>(null), [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), sequence = useRef(0);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    const value = reference.trim(), current = ++sequence.current;
    setResolved(null); setError(null);
    if (!value) { setResolving(false); return; }
    setResolving(true);
    const timer = setTimeout(() => {
      resolve({ projectId, reference: value }).then(
        found => { if (current === sequence.current) { setResolved(found); setResolving(false); } },
        failure => { if (current === sequence.current) { setError(worktreeErrorMessage(failure, `The ${terminology.singular} could not be found.`)); setResolving(false); } },
      );
    }, RESOLVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reference, projectId, resolve]);
  async function confirm(mode: "local" | "worktree") {
    if (!resolved || resolving || preparing) return;
    setPreparing(mode); setError(null);
    try { await onCheckout(reference.trim(), mode); }
    catch (failure) { setError(worktreeErrorMessage(failure, `The ${terminology.singular} could not be checked out.`)); setPreparing(null); }
  }
  const disabled = !resolved || resolving || !!preparing;
  return <GitDialogFrame className="pull-request-dialog" title={`Checkout ${terminology.singular}`} locked={!!preparing} onClose={onClose}
    description={`Resolve a ${provider?.name ?? "hosted"} ${terminology.singular}, then start a new thread on it in the main repo or in a dedicated worktree.`}
    footer={<>
      <button type="button" className="git-button git-button--outline" disabled={!!preparing} onClick={onClose}>Cancel</button>
      <button type="button" className="git-button git-button--outline" disabled={disabled} onClick={() => { void confirm("local"); }}>{preparing === "local" ? "Preparing local..." : "Local"}</button>
      <button type="button" className="git-button git-button--primary" disabled={disabled} onClick={() => { void confirm("worktree"); }}>{preparing === "worktree" ? "Preparing worktree..." : "Worktree"}</button>
    </>}>
    <label className="pull-request-dialog__field">
      <span>{terminology.singular}</span>
      <input ref={input} value={reference} placeholder={`${terminology.shortLabel} URL, checkout command, or #42`} disabled={!!preparing}
        onChange={event => setReference(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void confirm("worktree"); } }} />
    </label>
    {resolved && <div className="pull-request-dialog__preview">
      <div><p className="pull-request-dialog__title">{resolved.title}</p><p>#{resolved.number} · {resolved.headBranch} to {resolved.baseBranch}</p></div>
      <span data-state={resolved.state}>{resolved.state}</span>
    </div>}
    {resolving && <p className="pull-request-dialog__status" role="status">Resolving {terminology.singular}...</p>}
    {error && <p className="pull-request-dialog__error" role="alert">{error}</p>}
  </GitDialogFrame>;
}
