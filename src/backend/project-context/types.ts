export const INSTRUCTION_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;
export type ProjectInstruction = { path: string; content: string };
export type ContextWarning = (message: string) => void;
