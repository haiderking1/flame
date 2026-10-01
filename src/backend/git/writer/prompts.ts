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
