import { createFileTreeIconResolver, getBuiltInSpriteSheet, type FileTreeIcons } from "@pierre/trees";

export type FileIconResolution = { name: string; token: string };

const SPRITE_ID = "flame-file-icon-sprite";
const VIDEO_EXTENSIONS = ["avi", "m4v", "mkv", "mov", "mp4", "ogv", "webm"];
// Icons the built-in set lacks, as in T3 Code. The film icon is Lucide's (ISC license).
const EXTRA_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">
  <symbol id="flame-file-icon-video" viewBox="0 0 24 24">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4" />
    </g>
  </symbol>
  <symbol id="flame-file-icon-agents" viewBox="0 0 32 32">
    <path fill="currentColor" d="M27.2 16c0-6.19-5.01-11.2-11.2-11.2C9.81 4.8 4.8 9.81 4.8 16S9.81 27.2 16 27.2c6.19 0 11.2-5.01 11.2-11.2Zm-5.6 2.1a1.4 1.4 0 1 1 0 2.8h-4.2a1.4 1.4 0 1 1 0-2.8Zm-11.2-6.8c.622-.373 1.42-.208 1.84.361l.079.119 2.1 3.5.088.171c.15.351.15.748 0 1.1l-.088.171-2.1 3.5a1.4 1.4 0 0 1-2.4-1.44L11.59 16l-1.67-2.78-.067-.127c-.302-.642-.075-1.42.547-1.79ZM30 16c0 7.73-6.27 14-14 14S2 23.73 2 16 8.27 2 16 2s14 6.27 14 14Z" />
  </symbol>
  <symbol id="flame-file-icon-pnpm" viewBox="0 0 32 32">
    <path fill="#f9ad00" d="M30 10.75h-8.749V2H30Zm-9.626 0h-8.75V2h8.75Zm-9.625 0H2V2h8.749ZM30 20.375h-8.749v-8.75H30Z" />
    <path fill="currentColor" d="M20.374 20.375h-8.75v-8.75h8.75Zm0 9.625h-8.75v-8.75h8.75ZM30 30h-8.749v-8.75H30Zm-19.251 0H2v-8.75h8.749Z" />
  </symbol>
</svg>`;
const icons = {
  set: "complete", colored: true, spriteSheet: EXTRA_SPRITE,
  byFileName: {
    "package.json": "file-tree-builtin-npm", "tsconfig.json": "file-tree-builtin-typescript", "agents.md": "flame-file-icon-agents",
    "pnpm-lock.yaml": "flame-file-icon-pnpm", "pnpm-workspace.yaml": "flame-file-icon-pnpm",
  },
  byFileExtension: Object.fromEntries(VIDEO_EXTENSIONS.map(extension => [extension, "flame-file-icon-video"])),
} satisfies FileTreeIcons;
const resolver = createFileTreeIconResolver(icons);

// Dark-theme colors per icon token, from T3 Code.
const COLORS: Record<string, string> = {
  agents: "#adadb1", astro: "#d568ea", babel: "#ffd452", bash: "#5ecc71", biome: "#69b1ff", bootstrap: "#9d6afb", browserslist: "#ffd452",
  bun: "#79697b", c: "#69b1ff", claude: "#ffa359", cpp: "#69b1ff", css: "#9d6afb", database: "#d568ea", default: "#adadb1", docker: "#69b1ff",
  eslint: "#9d6afb", git: "#d5512f", go: "#68cdf2", graphql: "#ff678d", html: "#ffa359", image: "#ff678d", javascript: "#ffd452", json: "#ffa359",
  markdown: "#5ecc71", mcp: "#64d1db", nextjs: "#adadb1", npm: "#ff6762", oxc: "#68cdf2", pnpm: "#adadb1", postcss: "#ff6762", prettier: "#64d1db",
  python: "#69b1ff", react: "#68cdf2", ruby: "#ff6762", rust: "#ffa359", sass: "#ff678d", stylelint: "#adadb1", svelte: "#ff6762", svg: "#ffa359",
  svgo: "#5ecc71", swift: "#ffa359", table: "#64d1db", tailwind: "#68cdf2", terraform: "#9d6afb", text: "#adadb1", typescript: "#69b1ff",
  video: "#d568ea", vite: "#d568ea", vscode: "#69b1ff", vue: "#5ecc71", wasm: "#9d6afb", webpack: "#69b1ff", yml: "#ff6762", zig: "#ffa359", zip: "#ffa359",
};
// Code fence languages whose extension differs from their name.
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh", csharp: "cs", "c#": "cs", "c++": "cpp", golang: "go", javascript: "js", kotlin: "kt", markdown: "md", plaintext: "txt", python: "py",
  ruby: "rb", rust: "rs", shell: "sh", shellscript: "sh", console: "sh", zsh: "sh", typescript: "ts", yaml: "yml", text: "txt",
};

/** Resolves the icon for a file path or name, falling back to the generic file icon. */
export function resolveFileIcon(path: string): FileIconResolution {
  const icon = resolver.resolveIcon("file-tree-icon-file", path);
  // Rules matched by name carry no token; their symbol id names it.
  return { name: icon.name, token: icon.token ?? /^(?:file-tree-builtin|flame-file-icon)-(.+)$/.exec(icon.name)?.[1] ?? "default" };
}
export const fileIconColor = (token: string) => COLORS[token] ?? COLORS.default!;
/** A file name standing for a code fence language, so languages share file icons. */
export function languageFileName(language: string) {
  const normalized = language.trim().toLowerCase();
  return `file.${LANGUAGE_EXTENSIONS[normalized] ?? normalized}`;
}
/** Whether a language has its own icon rather than the generic file icon. */
export const hasLanguageIcon = (language: string) => !!language.trim() && resolveFileIcon(languageFileName(language)).token !== "default";

/** Adds the icon sprite to the document once; icons reference its symbols. */
export function ensureFileIconSprite() {
  if (typeof document === "undefined" || document.getElementById(SPRITE_ID)) return;
  const container = document.createElement("div");
  container.id = SPRITE_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  container.innerHTML = `${getBuiltInSpriteSheet("complete")}${EXTRA_SPRITE}`;
  document.body.prepend(container);
}
