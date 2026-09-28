const colors = ["#9ca3af", "#f87171", "#fb923c", "#fbbf24", "#facc15", "#a3e635", "#4ade80", "#34d399", "#2dd4bf", "#22d3ee", "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#c084fc", "#e879f9", "#f472b6", "#fb7185"];

export function projectIdentity(name: string) {
  const normalized = name.normalize("NFKC").trim();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = Array.from(words[0] ?? "PR");
  const last = words.length > 1 ? Array.from(words[words.length - 1]!)[0] : letters.at(-1);
  const second = letters.slice(1).find(letter => /\p{N}/u.test(letter)) ?? last ?? letters[0];
  const label = Array.from(`${letters[0]}${second}`.toUpperCase()).slice(0, 2).join("");
  let color = 0;
  for (const letter of normalized.toLocaleLowerCase("en-US") || "project") color = (31 * color + letter.codePointAt(0)!) % colors.length;
  return { label, color: colors[color]! };
}
