import { remoteRepository } from "../../contracts/source-control.js";
import { gitCommand } from "./command.js";
import { PRIMARY_REMOTE } from "./branch-state.js";
import type { HeadContext } from "./hosting/index.js";

async function config(root: string, key: string, signal?: AbortSignal) {
  const result = await gitCommand(root, ["config", "--get", key], { signal, allowed: [0, 1] });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
}
/** Where the branch lives on the host: its upstream branch name and, for forks, the owner that must prefix the head. */
export async function headContext(root: string, branch: string, upstream: string | null, signal?: AbortSignal): Promise<HeadContext> {
  const remote = await config(root, `branch.${branch}.remote`, signal) ?? PRIMARY_REMOTE;
  const headBranch = upstream && upstream.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : branch;
  const [headUrl, originUrl] = await Promise.all([config(root, `remote.${remote}.url`, signal), config(root, `remote.${PRIMARY_REMOTE}.url`, signal)]);
  const headRepository = headUrl ? remoteRepository(headUrl) : null, originRepository = originUrl ? remoteRepository(originUrl) : null;
  const crossRepository = !!headRepository && !!originRepository && headRepository.toLowerCase() !== originRepository.toLowerCase();
  const owner = headRepository?.split("/")[0] ?? null;
  return { branch, headBranch, owner, crossRepository, selector: crossRepository && owner ? `${owner}:${headBranch}` : headBranch };
}
