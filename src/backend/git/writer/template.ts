import { gitCommand } from "../command.js";

const MAX_TEMPLATE_BYTES = 8_000;
const FILES = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md", "PULL_REQUEST_TEMPLATE.md", "docs/pull_request_template.md", "docs/PULL_REQUEST_TEMPLATE.md"];
const DIRECTORIES = [".github/PULL_REQUEST_TEMPLATE/", "PULL_REQUEST_TEMPLATE/", "docs/PULL_REQUEST_TEMPLATE/"];
/** The GitHub pull request template on the base branch: a single known file, or a template directory holding exactly one Markdown file. */
export async function pullRequestTemplate(root: string, baseRef: string, signal?: AbortSignal) {
  const listing = await gitCommand(root, ["ls-tree", "-r", "-z", "--full-tree", "--name-only", baseRef, "--", ...FILES, ...DIRECTORIES], { signal, allowed: [0, 128], maxBytes: 256 * 1024 });
  if (listing.code !== 0) return null;
  const paths = listing.stdout.toString("utf8").split("\0").filter(Boolean);
  const chosen = FILES.find(file => paths.includes(file)) ?? DIRECTORIES.map(directory => paths.filter(path => path.startsWith(directory) && path.toLowerCase().endsWith(".md")))
    .find(found => found.length === 1)?.[0];
  if (!chosen) return null;
  const blob = await gitCommand(root, ["cat-file", "blob", `${baseRef}:${chosen}`], { signal, allowed: [0, 128], maxBytes: 1024 * 1024 });
  if (blob.code !== 0) return null;
  return blob.stdout.subarray(0, MAX_TEMPLATE_BYTES).toString("utf8").trim() || null;
}
