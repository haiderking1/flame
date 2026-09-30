export function hasImageInput(input: readonly unknown[]): boolean {
  return input.some(value => {
    if (!value || typeof value !== "object") return false;
    const item = value as { content?: unknown; output?: unknown };
    return [item.content, item.output].some(parts => Array.isArray(parts)
      && parts.some(part => !!part && typeof part === "object" && "type" in part && part.type === "input_image"));
  });
}
