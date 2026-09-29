export const slashCommands = [
  { id: "compact", text: "/compact", description: "Summarize older context. Keep your full conversation history." },
] as const;
export type SlashCommand = typeof slashCommands[number];

// Reserve only a standalone slash token. Paths and prose remain ordinary messages.
export function slashQuery(draft: string): string | null {
  const value = draft.trim();
  return /^\/[a-z]*$/i.test(value) ? value.slice(1).toLowerCase() : null;
}
export function matchingCommands(query: string): readonly SlashCommand[] {
  return slashCommands.filter(command => command.id.startsWith(query));
}
