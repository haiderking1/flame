import { GitStart } from "../../contracts/git.js";
/** Whether a stored operation was claimed with exactly this request (deep comparison of every request field). */
export function sameStart(input: GitStart, stored: GitStart) {
  return (Object.keys(GitStart.fields) as Array<keyof GitStart>).every(key => JSON.stringify(input[key] ?? null) === JSON.stringify(stored[key] ?? null));
}
