import type { Mail } from "../sessions/mailbox-store.js";

const TYPES = { task: "NEW_TASK", message: "MESSAGE", final: "FINAL_ANSWER" } as const;
/** How a message between agents reads to the agent receiving it. */
export function envelope(kind: Mail["kind"], recipient: string, sender: string, text: string) {
  return `Message Type: ${TYPES[kind]}\nTask name: ${recipient}\nSender: ${sender}\nPayload:\n${text}`;
}
/** Mail delivered into an agent's conversation: input from its team, not from the person using Flame. */
export function mailInput(recipient: string, mail: readonly Mail[]) {
  return mail.map(item => ({ role: "user", content: [{ type: "input_text", text: `[Message from another agent of your team, not a new human request]\n${envelope(item.kind, recipient, item.sender, item.text)}` }] }));
}
