import { memo, useEffect, useRef, useState } from "react";
import { highlight, type Highlight } from "./highlight";

export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [colored, setColored] = useState<{ code: string; language: string; lines: Highlight }>();
  const [wrap, setWrap] = useState(false), [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    let alive = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void highlight(code, language).then(lines => { if (alive) setColored({ code, language, lines }); });
    }, { rootMargin: "500px" });
    if (root.current) observer.observe(root.current);
    return () => { alive = false; observer.disconnect(); };
  }, [code, language]);
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);
  const lines = colored?.code === code && colored.language === language ? colored.lines : null;
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }
  return <div className="markdown-code" ref={root} data-wrap={wrap}>
    <div className="markdown-code__header">
      <span>{language || "text"}</span>
      <div className="markdown-code__actions">
        <button type="button" aria-label="Wrap code" aria-pressed={wrap} onClick={() => setWrap(!wrap)} title="Wrap code">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h9a2 2 0 0 1 0 4H8m2-2-2 2 2 2M2 12h3" /></svg>
        </button>
        <button type="button" aria-label="Copy code" onClick={() => void copy()} title="Copy code">
          <svg viewBox="0 0 16 16" aria-hidden="true">{copyState === "copied" ? <path d="m3 8 3 3 7-7" /> : <><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 10H2V2h8v1" /></>}</svg>
        </button>
      </div>
      <span className="markdown-code__feedback" role="status">{copyState === "copied" ? "Copied" : copyState === "failed" ? "Could not copy" : ""}</span>
    </div>
    <pre className="flame-scrollbar"><code>{lines ? lines.map((line, index) => <span className="markdown-code__line" key={index}>{line.map((token, i) => <span key={i} style={{ color: token.color, fontStyle: (token.fontStyle ?? 0) & 1 ? "italic" : undefined, fontWeight: (token.fontStyle ?? 0) & 2 ? 700 : undefined, textDecoration: (token.fontStyle ?? 0) & 4 ? "underline" : undefined }}>{token.text}</span>)}{index < lines.length - 1 ? "\n" : ""}</span>) : code}</code></pre>
  </div>;
});
