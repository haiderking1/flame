export function folderQuery(query: string) {
  const separator = Math.max(query.lastIndexOf("/"), query.lastIndexOf("\\"));
  if (separator < 0) return { directory: "~/", filter: query === "~" ? "" : query };
  return { directory: query.slice(0, separator + 1), filter: query.slice(separator + 1) };
}
export function directoryQuery(path: string, homePath?: string) {
  if (homePath) {
    const normalized = path.replaceAll("\\", "/");
    const home = homePath.replaceAll("\\", "/").replace(/\/+$/, "");
    if (normalized === home || normalized.startsWith(`${home}/`)) {
      const relative = normalized.slice(home.length).replace(/^\/+/, "");
      return relative ? `~/${relative.replace(/\/+$/, "")}/` : "~/";
    }
  }
  return /[/\\]$/.test(path) ? path : `${path}${path.includes("\\") ? "\\" : "/"}`;
}
