export const CODE_TOKENIZE_LINES = 15_000;
export const CODE_TOKENIZE_CHARACTERS = 512 * 1024;
export function canColorSource(...sources: readonly string[]) {
  return sources.every(source => {
    if (source.length > CODE_TOKENIZE_CHARACTERS) return false;
    let lines = 1;
    for (let index = 0; index < source.length; index++) if (source.charCodeAt(index) === 10 && ++lines > CODE_TOKENIZE_LINES) return false;
    return true;
  });
}
