export function folderQuery(query: string) {
  const separator = Math.max(query.lastIndexOf("/"), query.lastIndexOf("\\"));
  if (separator < 0) return { directory: "~/", filter: query === "~" ? "" : query };
  return { directory: query.slice(0, separator + 1), filter: query.slice(separator + 1) };
}
export function directoryQuery(path: string) {
  return /[/\\]$/.test(path) ? path : `${path}${path.includes("\\") ? "\\" : "/"}`;
}
