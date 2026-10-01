import type { GitPullRequest } from "../../../contracts/git.js";

/** The branch a change request is opened from, as the hosting provider sees it. */
export type HeadContext = { branch: string; headBranch: string; owner: string | null; crossRepository: boolean; selector: string };
export type CreatedRepository = { nameWithOwner: string; url: string; sshUrl: string; httpsUrl: string };
/** A hosting provider reached through its CLI: change requests, default branch, repository creation and the signed-in account. */
export interface Hosting {
  readonly kind: "github" | "gitlab";
  readonly name: string;
  readonly host: string;
  /** Change requests from this head, open ones first, then newest first. */
  changeRequests(cwd: string, head: HeadContext, state: "open" | "all", signal?: AbortSignal): Promise<GitPullRequest[]>;
  createChangeRequest(cwd: string, input: { base: string; head: HeadContext; title: string; bodyFile: string }, signal?: AbortSignal): Promise<void>;
  defaultBranch(cwd: string, signal?: AbortSignal): Promise<string | null>;
  createRepository(cwd: string, input: { repository: string; visibility: "private" | "public" }, signal?: AbortSignal): Promise<CreatedRepository>;
  account(cwd: string, signal?: AbortSignal): Promise<string>;
  /** The Git protocol the CLI is configured for; HTTPS when unset. */
  protocol(cwd: string, signal?: AbortSignal): Promise<"ssh" | "https">;
  /** Name and the host's private commit email for the signed-in account. */
  identity(cwd: string, signal?: AbortSignal): Promise<{ name: string; email: string }>;
}
export function newestFirst(requests: GitPullRequest[], updated: Map<GitPullRequest, number>) {
  return requests.sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || (updated.get(b) ?? 0) - (updated.get(a) ?? 0));
}
