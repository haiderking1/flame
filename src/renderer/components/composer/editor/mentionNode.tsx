import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { FileMentionChip } from "../mentions/FileMentionChip";
import { MENTION_NODE } from "./promptDoc";

function MentionView({ node }: NodeViewProps) {
  return <NodeViewWrapper as="span" className="file-mention-node" contentEditable={false}>
    <FileMentionChip path={String(node.attrs.path)} directory={!!node.attrs.directory} />
  </NodeViewWrapper>;
}
/** An inline, atomic file mention. It keeps its link source so the prompt text round-trips exactly. */
export const FileMentionNode = Node.create({
  name: MENTION_NODE, group: "inline", inline: true, atom: true, selectable: true, draggable: false,
  addAttributes() {
    return {
      path: { default: "", parseHTML: element => element.getAttribute("data-path") ?? "", renderHTML: attributes => ({ "data-path": attributes.path }) },
      directory: { default: false, parseHTML: element => element.hasAttribute("data-directory"), renderHTML: attributes => attributes.directory ? { "data-directory": "" } : {} },
      source: { default: "", parseHTML: element => element.getAttribute("data-source") ?? "", renderHTML: attributes => ({ "data-source": attributes.source }) },
    };
  },
  parseHTML() { return [{ tag: "span[data-file-mention]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", { "data-file-mention": "", ...HTMLAttributes }]; },
  // Copying a chip out of the editor gives its link text.
  renderText({ node }) { return String(node.attrs.source); },
  addNodeView() { return ReactNodeViewRenderer(MentionView, { as: "span" }); },
});
