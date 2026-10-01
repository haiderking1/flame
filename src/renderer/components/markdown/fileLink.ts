const SCHEME = /^[a-z][a-z\d+.-]*:(?!\d)/i, WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

/**
 * The file or folder a non-web markdown link points at, or null when it is not a file reference.
 * Accepts relative and absolute paths and file: URLs, dropping line anchors such as `#L12` or `:12:4`.
 */
export function filePathFromHref(href: string | undefined): { path: string; directory: boolean } | null {
  if (!href || href.length > 4096 || href.startsWith("#")) return null;
  let path = href;
  if (SCHEME.test(href) && !WINDOWS_DRIVE.test(href)) {
    if (!/^file:/i.test(href)) return null;
    try { path = decodeURIComponent(new URL(href).pathname); } catch { return null; }
  } else {
    try { path = decodeURIComponent(href); } catch { /* Keep the raw text. */ }
  }
  path = path.replace(/[?#].*$/, "").replace(/(?::\d+){1,2}$/, "").trim();
  if (!path || path === "." || path === "/") return null;
  const directory = /[\\/]$/.test(path);
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
  // Bare words are not file references; a name needs an extension, a path separator, or to be a dotfile.
  if (!name || (!directory && !/[\\/]/.test(path) && !name.includes("."))) return null;
  return { path: path.replace(/[\\/]+$/, ""), directory };
}
