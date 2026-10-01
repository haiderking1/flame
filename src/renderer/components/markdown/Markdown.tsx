import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { FileIcon } from "../files/FileIcon";
import { filePathFromHref } from "./fileLink";
import "./markdown.css";

function webLink(value: string | undefined): string | undefined {
  if (!value || value.length > 8192) return;
  try { const url = new URL(value); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { /* Non-web targets stay as text. */ }
}
const components: Components = {
  pre({ children }) {
    const child = Children.toArray(children)[0];
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return <pre>{children}</pre>;
    const code = String(child.props.children ?? "");
    const language = /(?:^|\s)language-([^\s]+)/.exec(child.props.className ?? "")?.[1]?.toLowerCase() ?? "";
    return <CodeBlock code={code} language={language} />;
  },
  a({ href, children, title, id }) {
    if (href?.startsWith("#")) return <a id={id} href={href} title={title} onClick={event => { event.preventDefault(); try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: "nearest" }); } catch { /* Ignore invalid fragment encoding. */ } }}>{children}</a>;
    const target = webLink(href);
    if (target) return <a href={target} title={title} target="_blank" rel="noopener noreferrer">{children}</a>;
    const file = filePathFromHref(href);
    return file ? <span className="markdown-file" title={href}><FileIcon path={file.path} directory={file.directory} />{children}</span> : <span title={href}>{children}</span>;
  },
  // Do not fetch model-supplied images automatically or load local files.
  img({ src, alt }) {
    const target = webLink(typeof src === "string" ? src : undefined);
    return target ? <a className="markdown-image" href={target} target="_blank" rel="noopener noreferrer">Image: {alt || "Open image"}</a> : <span className="markdown-image">{alt || "Image unavailable"}</span>;
  },
  table({ children }) { return <div className="markdown-table flame-scrollbar" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>; },
};
const plugins = [remarkGfm];
export const Markdown = memo(function Markdown({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  return <div className={`markdown ${className}`} data-streaming={streaming || undefined}>
    <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml={false}>{text}</ReactMarkdown>
  </div>;
});
