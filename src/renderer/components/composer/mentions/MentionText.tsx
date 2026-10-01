import { Fragment, memo } from "react";
import { findFileMentions } from "@contracts/file-mentions";
import { FileMentionChip } from "./FileMentionChip";

/** Prompt text with its file mentions shown as chips, as they looked in the composer. */
export const MentionText = memo(function MentionText({ text }: { text: string }) {
  const mentions = findFileMentions(text);
  if (!mentions.length) return <>{text}</>;
  const parts = [];
  let at = 0;
  for (const mention of mentions) {
    if (mention.start > at) parts.push(<Fragment key={`t${at}`}>{text.slice(at, mention.start)}</Fragment>);
    parts.push(<FileMentionChip key={`m${mention.start}`} path={mention.path} directory={mention.directory} />);
    at = mention.end;
  }
  if (at < text.length) parts.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>);
  return <>{parts}</>;
});
