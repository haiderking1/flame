import type { ProjectInstruction } from "./types.js";

export function formatProjectContext(files: ProjectInstruction[]) {
  if (!files.length) return "";
  const contents = ["Project-specific instructions and guidelines:",
    ...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
  ].join("\n\n");
  return `<project_context>\n${contents}\n</project_context>`;
}
