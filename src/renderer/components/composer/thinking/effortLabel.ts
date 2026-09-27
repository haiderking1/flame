export function effortLabel(effort: string): string {
  if (effort === "xhigh") return "Extra High";
  return effort.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
