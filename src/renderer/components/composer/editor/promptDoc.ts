import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { findFileMentions } from "../mentions/mentionSyntax";

export const MENTION_NODE = "fileMention";
/**
 * The editor holds one paragraph per line of the prompt. Text stays text, and each file link becomes an
 * atom node that keeps its original source, so text → document → text is lossless.
 */
export function promptToDoc(text: string): JSONContent {
  return { type: "doc", content: text.split("\n").map(line => {
    const content: JSONContent[] = [];
    let at = 0;
    for (const mention of findFileMentions(line)) {
      if (mention.start > at) content.push({ type: "text", text: line.slice(at, mention.start) });
      content.push({ type: MENTION_NODE, attrs: { path: mention.path, directory: mention.directory, source: mention.source } });
      at = mention.end;
    }
    if (at < line.length) content.push({ type: "text", text: line.slice(at) });
    return content.length ? { type: "paragraph", content } : { type: "paragraph" };
  }) };
}
const width = (node: ProseMirrorNode) => node.isText ? node.text!.length : node.type.name === MENTION_NODE ? String(node.attrs.source).length : 0;
/** The prompt text for a document (or slice content): lines joined by newlines, mentions as their source. */
export function docToPrompt(doc: ProseMirrorNode) {
  const lines: string[] = [];
  doc.forEach(block => {
    let line = "";
    block.forEach(child => { line += child.isText ? child.text! : child.type.name === MENTION_NODE ? String(child.attrs.source) : ""; });
    lines.push(line);
  });
  return lines.join("\n");
}
/** The prompt text offset for a document position. */
export function offsetAt(doc: ProseMirrorNode, pos: number) {
  let offset = 0, result = 0, found = false;
  doc.forEach((block, blockPos, index) => {
    if (found) return;
    if (index > 0) offset += 1;
    const start = blockPos + 1, end = blockPos + 1 + block.content.size;
    if (pos <= end) {
      let at = start, local = 0;
      block.forEach(child => {
        if (at >= pos) return;
        local += child.isText ? Math.min(child.nodeSize, pos - at) : width(child);
        at += child.nodeSize;
      });
      result = offset + local; found = true; return;
    }
    block.forEach(child => { offset += width(child); });
  });
  return found ? result : offset;
}
/** The document position for a prompt offset; an offset inside a mention's source lands after the mention. */
export function posAt(doc: ProseMirrorNode, target: number) {
  let offset = 0, result = -1;
  doc.forEach((block, blockPos, index) => {
    if (result >= 0) return;
    if (index > 0) offset += 1;
    let at = blockPos + 1;
    let blockWidth = 0; block.forEach(child => { blockWidth += width(child); });
    if (target > offset + blockWidth) { offset += blockWidth; return; }
    let local = target - offset;
    block.forEach(child => {
      if (result >= 0) return;
      const size = width(child);
      if (local <= (child.isText ? size : 0)) { result = at + Math.max(0, local); return; }
      if (local < size) { result = at + child.nodeSize; return; }
      local -= size; at += child.nodeSize;
    });
    if (result < 0) result = at;
  });
  return result >= 0 ? result : doc.content.size;
}
