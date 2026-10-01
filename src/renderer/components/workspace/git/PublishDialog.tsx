import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { GitHosting, GitPublish } from "@contracts/git";
import type { WorkspaceKey } from "../../../backend/workspaceKey";
import { gitHosting, gitOperations, gitErrorMessage } from "../../../backend/git";
import { WorkspaceIcon } from "../WorkspaceIcon";
import { GitDialogFrame } from "./GitDialogFrame";
import { openExternal, type RunInput } from "./useGitActionRunner";

type Provider = GitPublish["provider"];
const STEPS = ["Provider", "Repository", "Summary"] as const;
const placeholders: Record<Provider, string> = { github: "owner/repo", gitlab: "group/project" };
/** Splits "owner/name" and checks both parts are present. */
export const validRepository = (value: string) => { const [owner, ...rest] = value.trim().split("/"); return !!owner && rest.length > 0 && rest.every(Boolean); };
/** t3code's publish wizard: choose a signed-in host, name the repository, then see where it went. */
export default function PublishDialog({ workspace, run, onClose }: { workspace: WorkspaceKey; run(input: RunInput): Promise<string | null>; onClose(): void }) {
  const readHosting = useAtomSet(gitHosting, { mode: "promise" });
  const operations = useAtomValue(gitOperations(workspace));
  const [hostings, setHostings] = useState<readonly GitHosting[] | null>(null), [hostingError, setHostingError] = useState<string | null>(null);
  const [step, setStep] = useState(0), [chosen, setChosen] = useState<Provider | null>(null);
  const [repository, setRepository] = useState<string | null>(null), [visibility, setVisibility] = useState<GitPublish["visibility"]>("private");
  const [advanced, setAdvanced] = useState(false), [remote, setRemote] = useState("origin"), [chosenProtocol, setProtocol] = useState<GitPublish["protocol"] | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null), [startError, setStartError] = useState<string | null>(null);
  useEffect(() => { let live = true; readHosting().then(found => { if (live) setHostings(found); }, error => { if (live) setHostingError(gitErrorMessage(error)); }); return () => { live = false; }; }, [readHosting]);
  const ordered = [...(hostings ?? [])].sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name));
  const provider = ordered.find(item => item.kind === chosen && item.ready) ?? ordered.find(item => item.ready) ?? null;
  const operation = requestId && AsyncResult.isSuccess(operations) ? operations.value.find(item => item.requestId === requestId) ?? null : null;
  const publishing = !!requestId && (!operation || operation.state === "running");
  const failure = startError ?? (operation && operation.state !== "running" && operation.state !== "completed" ? operation.detail ?? "Publishing failed." : null);
  const result = operation?.state === "completed" ? operation.result?.publish ?? null : null;
  useEffect(() => { if (result) setStep(2); }, [result]);
  const name = repository ?? (provider?.account ? `${provider.account}/` : "");
  // Until changed by hand, the remote uses whatever protocol the host's CLI is set up for (gh defaults to HTTPS).
  const protocol = chosenProtocol ?? provider?.protocol ?? "https";
  const canPublish = !!provider && validRepository(name) && !publishing;
  async function publish() {
    if (!provider || !canPublish) return;
    setStartError(null);
    try { setRequestId(await run({ action: "publish", publish: { provider: provider.kind, repository: name.trim(), visibility, remote: remote.trim() || "origin", protocol } })); }
    catch (error) { setStartError(gitErrorMessage(error)); }
  }
  const summary = (index: number) => index === 0 && step > 0 && provider ? `: ${provider.name}` : index === 1 && result ? `: ${result.repository}` : "";
  return <GitDialogFrame className="git-dialog--wide" title="Publish repository" description="Pick where to host it, then point us at a repo to push to." locked={publishing} onClose={onClose} footer={
    step === 0 ? <><button type="button" className="git-button git-button--outline" onClick={onClose}>Cancel</button>
      <button type="button" className="git-button git-button--primary" disabled={!provider} onClick={() => setStep(1)}>Next</button></>
    : step === 1 ? <><button type="button" className="git-button git-button--outline" disabled={publishing} onClick={() => setStep(0)}>Back</button>
      <button type="button" className="git-button git-button--primary" disabled={!canPublish} onClick={() => { void publish(); }}>{publishing ? <><WorkspaceIcon name="loader" className="workspace-icon--spin" />Publishing...</> : "Publish"}</button></>
    : <button type="button" className="git-button git-button--primary" onClick={onClose}>Done</button>}>
    <ol className="git-steps">{STEPS.map((label, index) => <li key={label}>
      <button type="button" className="git-steps__step" aria-current={index === step ? "step" : undefined} disabled={step === 2 || index >= step} onClick={() => setStep(index)}>
        <span className={`git-steps__number${index < step ? " git-steps__number--done" : index === step ? " git-steps__number--current" : ""}`}>{index < step ? <WorkspaceIcon name="check" /> : index + 1}</span>
        <span className="git-steps__label">{label}{summary(index)}</span>
      </button></li>)}
    </ol>
    <div className="git-publish__band">
      {step === 0 && <div className="git-field"><span>Provider</span>
        {hostingError && <p className="git-alert" role="alert">{hostingError}</p>}
        {!hostings && !hostingError && <p className="git-pending" role="status"><WorkspaceIcon name="loader" className="workspace-icon--spin" />Checking GitHub and GitLab sign-in…</p>}
        <div className="git-publish__providers" role="radiogroup" aria-label="Provider">{ordered.map(item => <div key={item.kind} className="git-publish__provider-wrap">
          <button type="button" role="radio" aria-checked={provider?.kind === item.kind} className="git-card git-publish__provider" disabled={!item.ready} title={item.ready ? undefined : item.hint ?? undefined}
            onClick={() => { setChosen(item.kind); setRepository(null); }}><WorkspaceIcon name="pull-request" /><span>{item.name}</span>
            {!item.ready && <span className="git-publish__setup">Setup required</span>}</button>
          {!item.ready && item.hint && <p className="git-publish__hint">{item.hint}</p>}
        </div>)}</div>
      </div>}
      {step === 1 && provider && <div className="git-publish__repository">
        <label className="git-field"><span>Repository</span>
          <span className="git-joined-input"><span className="git-joined-input__prefix"><WorkspaceIcon name="pull-request" />{provider.host}/</span>
            <input value={name} placeholder={placeholders[provider.kind]} autoFocus spellCheck={false} disabled={publishing} onChange={event => setRepository(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void publish(); } }} /></span>
        </label>
        <div className="git-field"><span>Visibility</span><div className="git-publish__visibility" role="radiogroup" aria-label="Visibility">
          {(["private", "public"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={visibility === value} className="git-card" disabled={publishing} onClick={() => setVisibility(value)}>
            <WorkspaceIcon name={value === "private" ? "lock" : "globe"} /><span><strong>{value === "private" ? "Private" : "Public"}</strong><small>{value === "private" ? "Only invited people" : "Anyone on the web"}</small></span>
          </button>)}
        </div></div>
        <button type="button" className="git-publish__advanced" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><WorkspaceIcon name="chevron" />Advanced</button>
        {advanced && <div className="git-publish__advanced-fields">
          <label className="git-field"><span>Remote</span><input className="git-input" value={remote} maxLength={256} disabled={publishing} onChange={event => setRemote(event.target.value)} /></label>
          <div className="git-field"><span>Protocol</span><div className="git-toggle" role="radiogroup" aria-label="Protocol">
            {(["ssh", "https"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={protocol === value} disabled={publishing} onClick={() => setProtocol(value)}>{value.toUpperCase()}</button>)}
          </div></div>
        </div>}
        {publishing && <p className="git-pending" role="status"><WorkspaceIcon name="loader" className="workspace-icon--spin" />Publishing repository to {provider.name}...</p>}
        {failure && <div className="git-alert" role="alert"><strong>Publish failed</strong><p>{failure}</p></div>}
      </div>}
      {step === 2 && result && <div className="git-publish__done">
        <span className="git-publish__done-icon"><WorkspaceIcon name="check" /></span>
        <strong>{result.pushed ? "Repository published" : "Repository created"}</strong>
        <p>{result.pushed ? `${result.branch} is now live on ${provider?.name ?? "the host"}.` : `Remote "${result.remote}" is set up. Make a commit and push it to share your code.`}</p>
        <span className="git-publish__chip"><WorkspaceIcon name="pull-request" />{result.repository}</span>
        <button type="button" className="git-button git-button--outline git-button--block" onClick={() => openExternal(result.url)}>Open on {provider?.name ?? "host"}</button>
      </div>}
    </div>
  </GitDialogFrame>;
}
