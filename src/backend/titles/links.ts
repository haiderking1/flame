import { GH, GLAB, hostingCommand } from "../git/hosting/cli.js";

const LOOKUP_TIMEOUT_MS = 3_000;
const MAX_LINKS = 2;
type Lookup = { url: string; read(cwd: string, signal?: AbortSignal): Promise<{ title: string; body: string }> };
const subject = (value: unknown, body: "body" | "description") => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof record.title !== "string") throw new Error("The linked subject could not be read.");
  return { title: record.title, body: typeof record[body] === "string" ? record[body] as string : "" };
};
/**
 * The GitHub or GitLab pull request, merge request or issue a link names, read with its CLI. Only github.com and
 * gitlab.com: a link in a message must never make Flame send the CLI's credentials to a host the message chose.
 */
export function linkLookup(text: string): Lookup | null {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  url.hash = ""; url.search = "";
  if (url.host === "github.com") {
    const match = /^\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname);
    if (!match) return null;
    const endpoint = `repos/${match[1]}/${match[2]}/issues/${match[3]}`;
    return { url: url.href, read: async (cwd, signal) => subject(JSON.parse((await hostingCommand(GH, cwd, ["api", "--hostname", url.host, endpoint, "--jq", "{title, body}"],
      { signal, timeout: LOOKUP_TIMEOUT_MS, maxBytes: 32_000 })).stdout.toString("utf8")), "body") };
  }
  if (url.host === "gitlab.com") {
    const match = /^\/(.+)\/-\/(merge_requests|issues)\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname);
    if (!match) return null;
    const endpoint = `projects/${encodeURIComponent(match[1]!)}/${match[2]}/${match[3]}`;
    return { url: url.href, read: async (cwd, signal) => subject(JSON.parse((await hostingCommand(GLAB, cwd, ["api", "--hostname", url.host, endpoint],
      { signal, timeout: LOOKUP_TIMEOUT_MS, maxBytes: 32_000 })).stdout.toString("utf8")), "description") };
  }
  return null;
}
/** The first two supported links in a message, without duplicates. */
export function messageLinks(message: string): Lookup[] {
  const links = new Map<string, Lookup>();
  for (const match of message.matchAll(/https:\/\/[^\s<>"')\]`]+/g)) {
    const lookup = linkLookup(match[0].replace(/[.,;!?]+$/, ""));
    if (!lookup || links.has(lookup.url)) continue;
    links.set(lookup.url, lookup);
    if (links.size === MAX_LINKS) break;
  }
  return [...links.values()];
}
/**
 * What linked pull requests and issues are about, as T3 Code gives the title model: a link it cannot read in three
 * seconds is marked unavailable, so the model falls back to the link's number.
 */
export async function linkedContext(message: string, cwd: string, signal?: AbortSignal, links = messageLinks(message)) {
  const subjects = await Promise.all(links.map(async link => {
    try {
      const { title, body } = await link.read(cwd, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]));
      return `${link.url}\n${JSON.stringify({ title: title.slice(0, 300), body: body.slice(0, 1_200) })}`;
    } catch { return `${link.url}: unavailable`; }
  }));
  return subjects.length ? subjects.join("\n\n") : undefined;
}
