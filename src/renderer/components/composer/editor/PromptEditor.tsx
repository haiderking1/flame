import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { flushSync } from "react-dom";
import { FileMentionNode } from "./mentionNode";
import { docToPrompt, MENTION_NODE, offsetAt, posAt, promptToDoc } from "./promptDoc";
import { serializeFileMention } from "../mentions/mentionSyntax";
import "./prompt-editor.css";

export type PromptEditorHandle = {
  focus(): void;
  /** The editable element, for positioning menus and focus checks. */
  element(): HTMLElement | null;
  /** Replaces `expected` at [start, end) with a mention chip and a space; false if the text moved on meanwhile. */
  insertMention(range: { start: number; end: number; expected: string }, path: string, directory: boolean): boolean;
};
type Props = {
  value: string; placeholder: string; readOnly: boolean; ariaLabel: string;
  aria?: Record<string, string | undefined>;
  onChange(value: string): void;
  /** The caret's prompt offset, or null while text is selected or the editor is unfocused. */
  onCursor(offset: number | null): void;
  onFocusChange(focused: boolean): void;
  /** Handles a key first; returning true stops the editor's own handling. */
  onKeyDown(event: KeyboardEvent): boolean;
  onFiles(files: File[]): void;
};

const ShiftEnter = Extension.create({
  name: "shiftEnterNewLine",
  addKeyboardShortcuts() { return { "Shift-Enter": () => this.editor.commands.splitBlock() }; },
});

/**
 * The composer's prompt input: plain text in paragraphs (one per line) with file mentions as inline chips.
 * The prompt string stays the source of truth; the editor mirrors it and reports edits back.
 */
export const PromptEditor = forwardRef<PromptEditorHandle, Props>(function PromptEditor(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const editor = useEditor({
    immediatelyRender: true, shouldRerenderOnTransaction: false, injectCSS: false, editable: !props.readOnly,
    extensions: [Document, Paragraph, Text, FileMentionNode, UndoRedo, ShiftEnter, Placeholder.configure({ placeholder: () => latest.current.placeholder })],
    content: promptToDoc(props.value),
    editorProps: {
      attributes: { class: "composer__input flame-scrollbar", role: "textbox", "aria-multiline": "true", spellcheck: "false", autocapitalize: "off" },
      handleKeyDown: (view, event) => {
        if (view.composing || event.isComposing || event.keyCode === 229) return false;
        return latest.current.onKeyDown(event);
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => file !== null);
        if (!files.length) return false;
        latest.current.onFiles(files);
        return true;
      },
      // Files dropped on the composer are attachments, handled by the form.
      handleDrop: (_view, event) => !!event.dataTransfer?.types.includes("Files"),
      // Pasted text keeps its lines, and any file links in it become chips.
      clipboardTextParser: (text, _context, _plain, view) => new Slice(view.state.schema.nodeFromJSON(promptToDoc(text.replace(/\r\n?/g, "\n"))).content, 1, 1),
      clipboardTextSerializer: (slice, view) => {
        const doc = view.state.schema.topNodeType.createAndFill(null, slice.content.firstChild?.isBlock ? slice.content : view.state.schema.nodes.paragraph!.create(null, slice.content));
        return doc ? docToPrompt(doc) : "";
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // Commit the draft before the next key is handled, as a textarea's change event does; otherwise a fast
      // Enter could submit the previous text. ProseMirror reads typing from DOM mutations outside React's events.
      if (transaction.docChanged) { const text = docToPrompt(editor.state.doc); flushSync(() => latest.current.onChange(text)); }
      report();
    },
    onSelectionUpdate: () => report(),
    onFocus: () => { latest.current.onFocusChange(true); report(); },
    onBlur: () => { latest.current.onFocusChange(false); latest.current.onCursor(null); },
  });
  function report() {
    const { selection, doc } = editor.state;
    latest.current.onCursor(editor.isFocused && selection.empty ? offsetAt(doc, selection.head) : null);
  }
  // Mirror outside changes (draft restore, clearing after send) without echoing them back as edits.
  useLayoutEffect(() => {
    if (docToPrompt(editor.state.doc) === props.value) return;
    editor.commands.setContent(promptToDoc(props.value), { emitUpdate: false });
    editor.commands.setTextSelection(editor.state.doc.content.size);
  }, [editor, props.value]);
  useEffect(() => { if (editor.isEditable === props.readOnly) editor.setEditable(!props.readOnly, false); }, [editor, props.readOnly]);
  // Read the prompt off the element the way scripts read a textarea, computed only when asked.
  useEffect(() => {
    Object.defineProperties(editor.view.dom, {
      value: { configurable: true, get: () => docToPrompt(editor.state.doc) },
      readOnly: { configurable: true, get: () => !editor.isEditable },
    });
  }, [editor]);
  useEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-label", props.ariaLabel);
    dom.setAttribute("aria-readonly", String(props.readOnly));
    for (const [name, value] of Object.entries(props.aria ?? {})) value === undefined ? dom.removeAttribute(name) : dom.setAttribute(name, value);
  });
  useImperativeHandle(ref, () => ({
    focus: () => { editor.commands.focus(); },
    element: () => editor.isDestroyed ? null : editor.view.dom,
    insertMention: (range, path, directory) => {
      const text = docToPrompt(editor.state.doc);
      if (text.slice(range.start, range.end) !== range.expected) return false;
      // One space follows the chip; reuse a space that is already there.
      const end = text[range.end] === " " ? range.end + 1 : range.end;
      const from = posAt(editor.state.doc, range.start), to = posAt(editor.state.doc, end);
      const source = serializeFileMention(path, directory);
      return editor.chain().focus().insertContentAt({ from, to }, [{ type: MENTION_NODE, attrs: { path, directory, source } }, { type: "text", text: " " }]).run();
    },
  }), [editor]);
  return <EditorContent editor={editor} className="composer__editor" />;
});
