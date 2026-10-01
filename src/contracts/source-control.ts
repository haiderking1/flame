import { Schema } from "effect";

export const SourceControlKind = Schema.Literals(["github", "gitlab", "forgejo", "azure-devops", "bitbucket", "unknown"]);
export type SourceControlKind = typeof SourceControlKind.Type;
export const SourceControlProvider = Schema.Struct({ kind: SourceControlKind, name: Schema.String, host: Schema.String });
export type SourceControlProvider = typeof SourceControlProvider.Type;

export type ChangeRequestTerminology = { shortLabel: string; singular: string };
export const DEFAULT_TERMINOLOGY: ChangeRequestTerminology = { shortLabel: "PR", singular: "pull request" };
/** Wording for the hosting provider's review requests: GitLab says merge request, unknown hosts get a neutral term. */
export function changeRequestTerminology(kind: SourceControlKind | null | undefined): ChangeRequestTerminology {
  if (kind === "gitlab") return { shortLabel: "MR", singular: "merge request" };
  if (kind === "unknown") return { shortLabel: "change request", singular: "change request" };
  return DEFAULT_TERMINOLOGY;
}
const names: Record<SourceControlKind, string> = { github: "GitHub", gitlab: "GitLab", forgejo: "Forgejo", "azure-devops": "Azure DevOps", bitbucket: "Bitbucket", unknown: "Git host" };
export const sourceControlName = (kind: SourceControlKind) => names[kind];

/** Host of a remote URL in https, ssh (`ssh://` or scp-like `user@host:path`) or git form, lowercased; null when unparseable. */
export function remoteHost(url: string): string | null {
  const trimmed = url.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\/)/.exec(trimmed);
  if (scp) return scp[1]!.toLowerCase();
  try { const host = new URL(trimmed).hostname.toLowerCase(); return host || null; } catch { return null; }
}
/** Detects the hosting provider from a remote URL, using the same host rules as t3code. */
export function detectSourceControl(url: string): SourceControlProvider | null {
  const host = remoteHost(url);
  if (!host) return null;
  const labels = host.split(".");
  const kind: SourceControlKind = host === "codeberg.org" || labels.some(label => label === "forgejo" || label === "gitea") ? "forgejo"
    : host === "github.com" || labels.includes("github") ? "github"
    : labels.some(label => label === "gitlab") ? "gitlab"
    : host === "dev.azure.com" || host.endsWith(".visualstudio.com") ? "azure-devops"
    : labels.some(label => label === "bitbucket") ? "bitbucket" : "unknown";
  return { kind, name: names[kind], host };
}
/** `owner/name` of a remote URL path, without a trailing `.git`; null for anything else. */
export function remoteRepository(url: string): string | null {
  const trimmed = url.trim();
  const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(trimmed);
  let path: string;
  if (scp) path = scp[1]!;
  else { try { path = new URL(trimmed).pathname; } catch { return null; } }
  const parts = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/").filter(Boolean);
  return parts.length >= 2 ? parts.join("/") : null;
}
