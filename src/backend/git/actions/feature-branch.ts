import { gitCommand, gitText } from "../command.js";
import { uniqueBranchName } from "../branch-names.js";

/** Creates and switches to a new branch, carrying the staged index over; returns the name actually used. */
export async function switchToFeatureBranch(root: string, preferred: string, signal: AbortSignal) {
  const existing = (await gitText(root, ["branch", "--list", "--no-column", "--format=%(refname:short)"], { signal })).split("\n").filter(Boolean);
  const name = uniqueBranchName(existing, preferred);
  await gitCommand(root, ["check-ref-format", "--branch", name], { signal });
  await gitCommand(root, ["switch", "-c", name], { signal });
  return name;
}
