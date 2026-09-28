import { bundledLanguages, createHighlighter } from "shiki";
import type { BundledLanguage, ThemedToken } from "shiki";

const highlighter = createHighlighter({ themes: ["github-dark"], langs: [] }).catch(() => null);
const aliases: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", sh: "shellscript", bash: "shellscript", shell: "shellscript", py: "python", rs: "rust", yml: "yaml", cs: "csharp", csharp: "csharp", "c++": "cpp", md: "markdown", dockerfile: "docker" };
self.onmessage = async (event: MessageEvent<{ id: number; code: string; language: string }>) => {
  const { id, code, language } = event.data;
  try {
    const lang = aliases[language] ?? language;
    const sourceLines = code.split("\n");
    if (!Object.hasOwn(bundledLanguages, lang) || code.length > 128 * 1024 || sourceLines.length > 5000 || sourceLines.some(line => line.length > 20_000)) {
      self.postMessage({ id, lines: null }); return;
    }
    const engine = await highlighter;
    if (!engine) { self.postMessage({ id, lines: null }); return; }
    if (!engine.getLoadedLanguages().includes(lang)) {
      if (engine.getLoadedLanguages().length >= 64) { self.postMessage({ id, lines: null }); return; }
      await engine.loadLanguage(lang as BundledLanguage);
    }
    const lines = engine.codeToTokens(code, { lang: lang as BundledLanguage, theme: "github-dark" }).tokens.map(line => line.map((token: ThemedToken) => ({ text: token.content, color: token.color, fontStyle: token.fontStyle })));
    self.postMessage({ id, lines: lines.reduce((count, line) => count + line.length, 0) > 16_000 ? null : lines });
  } catch { self.postMessage({ id, lines: null }); }
};
