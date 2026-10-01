import { runProcess, type ProcessOptions } from "./process.js";
export { safeGitMessage } from "./process.js";

const messages = {
  missing: "Git is not installed or is not on PATH.",
  failed: "Git could not be started. Check the project directory and permissions.",
  interrupted: "Git was interrupted. Inspect repository state before starting another action.",
  deadline: "Git exceeded its execution deadline. Inspect repository state and your network or hooks before retrying.",
  oversized: "Git output exceeds the safe viewing limit. Use your terminal to inspect this repository.",
  exit: (code: number | null) => `Git failed with exit code ${code}.`,
};
export type GitCommandOptions = ProcessOptions & { config?: readonly (readonly [string, string])[] };
/** Runs git non-interactively with repository-redirecting variables removed, so the project directory alone decides the repository. */
export function gitCommand(cwd: string, args: readonly string[], options: GitCommandOptions = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never", LC_ALL: "C" };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|CONFIG|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|TRACE2)/.test(key)) delete env[key];
  Object.assign(env, options.env);
  if (options.config?.length) {
    env.GIT_CONFIG_COUNT = String(options.config.length);
    options.config.forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value; });
  }
  return runProcess("git", cwd, ["--no-pager", "-c", "core.quotepath=false", ...args], env, messages, options);
}
/** Trimmed stdout of a successful command. */
export const gitText = async (cwd: string, args: readonly string[], options: GitCommandOptions = {}) => (await gitCommand(cwd, args, options)).stdout.toString("utf8").trim();
