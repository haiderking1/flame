import { GitError } from "../../../contracts/git.js";
import { runProcess, type ProcessOptions } from "../process.js";

type Tool = { binary: string; label: string; login: string; env: NodeJS.ProcessEnv };
export const GH: Tool = { binary: "gh", label: "GitHub CLI (`gh`)", login: "gh auth login",
  env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1", GH_PAGER: "cat", NO_COLOR: "1", CLICOLOR: "0", GH_SPINNER_DISABLED: "1" } };
export const GLAB: Tool = { binary: "glab", label: "GitLab CLI (`glab`)", login: "glab auth login",
  env: { NO_PROMPT: "1", GLAB_NO_PROMPT: "1", GLAB_CHECK_UPDATE: "false", GLAB_SEND_TELEMETRY: "false", NO_COLOR: "1", PAGER: "cat" } };

const UNAUTHENTICATED = /(not logged in|auth login|authentication (required|failed)|401 unauthorized|no token|HTTP 401|bad credentials)/i;
const RATE_LIMITED = /(rate limit|HTTP 429|API rate|secondary rate)/i;
/** Runs a hosting CLI non-interactively and maps its failures to fixed, actionable messages. */
export async function hostingCommand(tool: Tool, cwd: string, args: readonly string[], options: ProcessOptions = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...tool.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  try {
    return await runProcess(tool.binary, cwd, args, env, {
      missing: `${tool.label} is required but not available on PATH. Install it, then retry.`,
      failed: `${tool.label} could not be started. Check that it is installed correctly.`,
      interrupted: `${tool.label} was interrupted. Check the hosting provider before retrying.`,
      deadline: `${tool.label} did not respond in time. Check your network and retry.`,
      oversized: `${tool.label} returned more output than expected.`,
      exit: code => `${tool.label} failed with exit code ${code}.`,
    }, { timeout: 60_000, maxBytes: 4 * 1024 * 1024, ...options });
  } catch (error) {
    if (!(error instanceof GitError) || error.code !== "COMMAND") throw error;
    if (UNAUTHENTICATED.test(error.message)) throw new GitError({ code: "INVALID", message: `${tool.label} is not authenticated. Run \`${tool.login}\` and retry.` });
    if (RATE_LIMITED.test(error.message)) throw new GitError({ code: "BUSY", message: `${tool.label} hit the provider's rate limit. Wait a few minutes and retry.` });
    throw error;
  }
}
export function parseJson<T>(output: Buffer, label: string): T {
  try { return JSON.parse(output.toString("utf8")) as T; }
  catch { throw new GitError({ code: "COMMAND", message: `${label} returned output Flame could not read. Update it and retry.` }); }
}
