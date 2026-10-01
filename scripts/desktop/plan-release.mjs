/**
 * Plans a release workflow run from the event and the repository's tags, and writes the plan to $GITHUB_OUTPUT.
 *
 *   node scripts/desktop/plan-release.mjs --event push|schedule|workflow_dispatch [--ref refs/tags/vX.Y.Z] [--channel nightly|stable|preview] [--run N]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { planRelease } from "./plan.mjs";

const { values } = parseArgs({ options: { event: { type: "string" }, ref: { type: "string" }, channel: { type: "string" }, run: { type: "string", default: "0" } } });
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const tags = git("tag", "--list", "v*").split("\n").filter(Boolean);
const lastNightly = git("tag", "--list", "v*-nightly.*", "--sort=-creatordate").split("\n").find(Boolean);
const plan = planRelease({
  event: values.event, ref: values.ref, channel: values.channel, run: values.run, tags,
  packageVersion: JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version,
  today: new Date().toISOString().slice(0, 10).replaceAll("-", ""),
  head: git("rev-parse", "HEAD"), lastNightlyCommit: lastNightly ? git("rev-list", "-n", "1", lastNightly) : null,
});
console.log(JSON.stringify(plan, null, 2));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(""));
