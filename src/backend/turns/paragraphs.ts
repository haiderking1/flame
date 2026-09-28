// Deliver complete Markdown blocks, never a token-sized typing animation.
export function paragraphBoundary(text: string): number {
  let fence: { character: string; length: number; indent: number } | null = null;
  let end = 0, offset = 0, heading = false;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const line = text.slice(offset, newline < 0 ? undefined : newline).replace(/[ \t\r]+$/, "");
    if (!fence && !heading && offset && /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]/.test(line)) end = offset;
    if (newline < 0) break;
    const match = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (match && match[2]![0] === fence.character && match[2]!.length >= fence.length && match[1]!.length <= fence.indent + 3 && !match[3]) {
        fence = null; end = newline + 1;
      }
    } else if (match) {
      fence = { character: match[2]![0]!, length: match[2]!.length, indent: match[1]!.length }; heading = false;
    } else if (/^[ \t]*$/.test(line)) {
      if (!heading) end = newline + 1;
    } else {
      if (!heading && offset && /^#{1,6}(?:[ \t]|$)/.test(line)) end = offset;
      heading = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|\*\*[^\n]+\*\*:?$)/.test(line);
    }
    offset = newline + 1;
  }
  return end;
}
