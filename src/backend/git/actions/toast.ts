import type { GitAction, GitResult, GitToastCta } from "../../../contracts/git.js";
import { changeRequestTerminology, sourceControlName, type SourceControlKind } from "../../../contracts/source-control.js";

const truncate = (text: string | null | undefined) => !text ? null : text.length > 72 ? `${text.slice(0, 69)}...` : text;
/** Final toast copy and call to action, matching t3code's summaries. */
export function completionToast(action: GitAction, result: Omit<GitResult, "toast">, context: { kind: SourceControlKind | null; isDefaultBranch: boolean; openPrUrl: string | null; canPush?: boolean }): GitResult["toast"] {
  const terminology = changeRequestTerminology(context.kind);
  if (action === "init") return { title: "Initialized repository", description: "No files were staged or committed.", cta: { kind: "none" } };
  if (action === "pull" && result.pull) return result.pull.updated
    ? { title: "Pulled", description: truncate(`Updated ${result.pull.branch} from ${result.pull.upstream}`), cta: { kind: "none" } }
    : { title: "Already up to date", description: truncate(`${result.pull.branch} is already synchronized.`), cta: { kind: "none" } };
  if (action === "publish" && result.publish) return { title: result.publish.pushed ? "Repository published" : "Repository created",
    description: truncate(result.publish.pushed ? `${result.publish.branch} is now live on ${context.kind ? sourceControlName(context.kind) : "the host"}.` : `Remote "${result.publish.remote}" is set up. Make a commit and push it to share your code.`),
    cta: { kind: "open_pr", label: `Open on ${context.kind ? sourceControlName(context.kind) : "host"}`, url: result.publish.url } };
  const sha = result.commit?.sha.slice(0, 7);
  let title = "Done", description: string | null = null;
  if (result.pr) { title = `${result.pr.status === "created" ? "Created" : "Opened"} ${terminology.shortLabel}${result.pr.number ? ` #${result.pr.number}` : ""}`; description = result.pr.title; }
  else if (result.push && !result.push.skipped) { title = `Pushed ${sha ? `${sha} ` : ""}to ${result.push.upstream}`; description = result.commit?.subject ?? null; }
  else if (result.commit) { title = `Committed ${sha}`; description = result.commit.subject; }
  else if (result.push?.skipped) title = "Already up to date";
  let cta: GitToastCta = { kind: "none" };
  const prUrl = result.pr?.url ?? context.openPrUrl;
  if (action === "commit" && result.commit) { if (context.canPush !== false) cta = { kind: "run_action", label: "Push", action: "push" }; }
  else if (action !== "commit" && prUrl && (!context.isDefaultBranch || result.pr)) cta = { kind: "open_pr", label: `View ${terminology.shortLabel}`, url: prUrl };
  else if ((action === "push" || action === "commit_push") && result.push && !result.push.skipped && !context.isDefaultBranch && (context.kind === "github" || context.kind === "gitlab")) cta = { kind: "run_action", label: `Create ${terminology.shortLabel}`, action: "create_pr" };
  return { title, description: truncate(description), cta };
}
