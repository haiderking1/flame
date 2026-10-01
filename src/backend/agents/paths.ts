/** Agent paths name each agent in its team: `/root` is the thread's own agent, and an agent it starts as `review` is `/root/review`. */
export const ROOT_PATH = "/root";
const TASK_NAME = /^[a-z0-9_]+$/;
/** Why a task name cannot name a new agent, or null when it can. */
export function taskNameProblem(name: string) {
  if (name.includes("/")) return "agent_name must not contain `/`";
  if (name === "root") return "agent_name `root` is reserved";
  if (!TASK_NAME.test(name) || name.length > 64) return "agent_name must use only lowercase letters, digits, and underscores";
  return null;
}
/** The canonical path a caller's reference names: absolute from `/root`, or relative to the caller. */
export function resolvePath(caller: string, target: string) {
  const trimmed = target.trim().replace(/\/+$/, "");
  if (trimmed === ROOT_PATH || trimmed.startsWith(`${ROOT_PATH}/`)) return trimmed;
  return `${caller}/${trimmed}`;
}
