import { ImageGallery } from "../../images/ImageGallery";
import type { ImageSource } from "../../images/useImageUrl";
import { MentionText } from "../../composer/mentions/MentionText";

export function UserMessage({ text, images, pending = false }: { text: string; images: readonly ImageSource[]; pending?: boolean }) {
  return <article className="session-message session-message--user" aria-label="You" aria-busy={pending || undefined}>
    <ImageGallery images={images} />{text && <p><MentionText text={text} /></p>}
  </article>;
}
