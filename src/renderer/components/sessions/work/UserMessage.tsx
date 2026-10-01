import { useContext } from "react";
import type { SessionEntry } from "@contracts/sessions";
import { ImageGallery } from "../../images/ImageGallery";
import type { ImageSource } from "../../images/useImageUrl";
import { MentionText } from "../../composer/mentions/MentionText";
import { EditMessageContext } from "./editMessage";

export function UserMessage({ text, images, pending = false, entry }: { text: string; images: readonly ImageSource[]; pending?: boolean; entry?: SessionEntry }) {
  const edit = useContext(EditMessageContext);
  return <div className="session-message__user">
    <article className="session-message session-message--user" aria-label="You" aria-busy={pending || undefined}>
      <ImageGallery images={images} />{text && <p><MentionText text={text} /></p>}
    </article>
    {/* One element per message: long histories stay light. The icon is drawn by CSS. */}
    {edit && entry && <button type="button" className="session-message__action" aria-label="Edit from here" title="Edit from here" disabled={edit.disabled} onClick={() => edit.request(entry)} />}
  </div>;
}
