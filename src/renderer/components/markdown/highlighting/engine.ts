import { bundledLanguages, createHighlighter } from "shiki";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import type { BundledLanguage, Highlighter } from "shiki";
import type { Highlight } from "./types.ts";

const aliases: Record<string, string> = { ts: "typescript", js: "javascript", sh: "shellscript", bash: "shellscript", shell: "shellscript", py: "python", rs: "rust", yml: "yaml", cs: "csharp", "c++": "cpp", md: "markdown", dockerfile: "docker" };
export function normalizeLanguage(language: string) { const lower = language.trim().toLowerCase(); return Object.hasOwn(aliases, lower) ? aliases[lower]! : lower; }
export function createHighlightEngine(factory: () => Promise<Highlighter> = () => createHighlighter({
  themes: ["github-dark"], langs: [], engine: createOnigurumaEngine(import("shiki/wasm")),
})) {
  let initialization: Promise<Highlighter> | undefined;
  const loading = new Map<string, Promise<void>>();
  function get() {
    if (!initialization) initialization = factory().catch(error => { initialization = undefined; throw error; });
    return initialization;
  }
  return async (code: string, language: string): Promise<Highlight> => {
    const lang = normalizeLanguage(language);
    if (!Object.hasOwn(bundledLanguages, lang)) return null;
    try {
      const engine = await get();
      if (!engine.getLoadedLanguages().includes(lang)) {
        let request = loading.get(lang);
        if (!request) {
          if (engine.getLoadedLanguages().length + loading.size >= 64) return null;
          request = engine.loadLanguage(lang as BundledLanguage).finally(() => { loading.delete(lang); });
          loading.set(lang, request);
        }
        await request;
      }
      return engine.codeToTokens(code, { lang: lang as BundledLanguage, theme: "github-dark" }).tokens.map(line => line.map(token => ({ text: token.content, color: token.color, fontStyle: token.fontStyle })));
    } catch { return null; }
  };
}
