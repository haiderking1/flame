import type { ImageInfo } from "../../contracts/image-types.js";
import type { TitleMessage } from "../sessions/title-record.js";

const MAX_CONTEXT = 8_000;
const MAX_MESSAGE = 2_000;
const OMITTED = "[Earlier content truncated]\n\n";
const TRUNCATED = "\n[Content truncated]\n";

/** Keeps the request and its final constraints when a message is too long, as T3 Code does. */
export function limitTitleMessage(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (budget <= TRUNCATED.length) return "";
  const available = budget - TRUNCATED.length;
  const head = Math.ceil(available / 2), tail = available - head;
  return `${text.slice(0, head)}${TRUNCATED}${tail > 0 ? text.slice(-tail) : ""}`;
}

/**
 * The thread as the title model reads it when regenerating, ported from T3 Code: space goes to the user's messages
 * first (the first one, then the latest), assistant answers fill what is left, in conversation order. Returns the
 * first message's first image and the latest three others, to show the model when it reads images.
 */
export function formatThreadTitleContext(messages: readonly TitleMessage[]): { message: string; images: readonly ImageInfo[] } {
  const sections = messages.flatMap((message, index) => !message.text.trim() && !message.images.length ? []
    : [{ index, message, prefix: `${message.role.toUpperCase()}:\n` }]);
  type Section = (typeof sections)[number];
  const formatted = new Map<number, string>();
  const contentsFor = (section: Section) => {
    const cached = formatted.get(section.index);
    if (cached !== undefined) return cached;
    const names = section.message.images.map(image => image.name).join(", ");
    const contents = [section.message.text.trim(), ...(names ? [`[Attachments: ${names}]`] : [])].filter(Boolean).join("\n");
    formatted.set(section.index, contents);
    return contents;
  };
  const selected = new Map<number, string>();
  let remaining = MAX_CONTEXT - OMITTED.length;
  const add = (section: Section, budget: number) => {
    if (selected.has(section.index)) return;
    const limit = Math.min(budget, remaining) - section.prefix.length - 2;
    if (limit <= TRUNCATED.length) return;
    const contents = limitTitleMessage(contentsFor(section), limit);
    if (!contents) return;
    const text = section.prefix + contents;
    selected.set(section.index, text);
    remaining -= text.length + 2;
  };
  const firstUser = sections.find(section => section.message.role === "user");
  if (firstUser) add(firstUser, MAX_MESSAGE);
  // Up to 6,000 characters go to user messages. Assistant output cannot evict them.
  for (const section of sections.toReversed()) if (section.message.role === "user") add(section, Math.min(MAX_MESSAGE, remaining - 2_000));
  for (const section of sections.toReversed()) if (section.message.role === "assistant") add(section, MAX_MESSAGE);
  // Use spare space when the conversation has only a few messages.
  for (const role of ["user", "assistant"] as const) {
    for (const section of sections.toReversed()) {
      const previous = selected.get(section.index);
      if (section.message.role !== role || previous === undefined) continue;
      const expanded = section.prefix + limitTitleMessage(contentsFor(section), previous.length + remaining - section.prefix.length);
      remaining -= expanded.length - previous.length;
      selected.set(section.index, expanded);
    }
  }
  const retained = sections.filter(section => selected.has(section.index));
  const truncated = retained.some(section => selected.get(section.index) !== section.prefix + contentsFor(section));
  const images = retained.flatMap(section => section.message.images);
  const first = firstUser?.message.images[0];
  const recent = images.filter(image => image.id !== first?.id);
  return {
    message: `${truncated || retained.length < sections.length ? OMITTED : ""}${retained.map(section => selected.get(section.index)).join("\n\n")}`,
    images: [...(first ? [first] : []), ...recent.slice(first ? -3 : -4)],
  };
}
