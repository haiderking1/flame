/** Prompts ported from t3code's text generation, so generated commits and change requests read the same way. */
const limit = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;

export const WRITER_INSTRUCTIONS = "You write git commit messages and change request descriptions. Reply with only the requested JSON object, no prose and no code fences.";

export function commitPrompt(input: { branch: string | null; summary: string; patch: string; includeBranch: boolean; conventions: string }) {
  return [
    "You write concise git commit messages.",
    input.includeBranch ? "Return a JSON object with keys: subject, body, branch." : "Return a JSON object with keys: subject, body.",
    "Rules:",
    "- subject must be imperative, <= 72 chars, and no trailing period",
    "- body can be empty string or short bullet points",
    ...(input.includeBranch ? ["- branch must be a short semantic git branch fragment for this change"] : []),
    "- capture the primary user-visible or developer-visible change",
    ...(input.conventions ? ["", "Additional instructions:", input.conventions] : []),
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limit(input.summary, 6_000),
    "",
    "Staged patch:",
    limit(input.patch, 40_000),
  ].join("\n");
}

/** T3 Code's branch-name prompt; attachments are listed by name, size and type, and also sent when the model reads images. */
export function branchNamePrompt(input: { message: string; attachments: readonly { name: string; mimeType: string; sizeBytes: number }[] }) {
  return [
    "You generate concise git branch names.",
    "Return a JSON object with key: branch.",
    "Rules:",
    "- Branch should describe the requested work from the user message.",
    "- Keep it short and specific (2-6 words).",
    "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
    "- If images are attached, use them as primary context for visual/UI issues.",
    "",
    "User message:",
    limit(input.message, 8_000),
    ...(input.attachments.length ? ["", "Attachment metadata:", limit(input.attachments.map(item => `- ${item.name} (${item.mimeType}, ${item.sizeBytes} bytes)`).join("\n"), 4_000)] : []),
  ].join("\n");
}

export function changeRequestPrompt(input: { base: string; head: string; commits: string; stat: string; patch: string; template: string | null; conventions: string; singular: string }) {
  const structure = input.template ? [
    `- body must be markdown and follow the repository ${input.singular} template structure`,
    "- fill in the template sections appropriately for this change",
    "- drop HTML comments from the template in the generated body",
    "- keep the template's markdown structure",
  ] : [
    "- body must be markdown and include headings '## Summary' and '## Testing'",
    "- under Summary, provide short bullet points",
    "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
  ];
  return [
    "You write source control change request content.",
    "Return a JSON object with keys: title, body.",
    "Rules:",
    "- title should be concise and specific",
    ...structure,
    ...(input.conventions ? ["", "Additional instructions:", input.conventions] : []),
    ...(input.template ? ["", `Repository ${input.singular} template:`, input.template] : []),
    "",
    `Base branch: ${input.base}`,
    `Head branch: ${input.head}`,
    "",
    "Commits:",
    limit(input.commits, 12_000),
    "",
    "Diff stat:",
    limit(input.stat, 12_000),
    "",
    "Diff patch:",
    limit(input.patch, 40_000),
  ].join("\n");
}
