import { createHighlightEngine } from "./highlighting/engine";
import { MAX_CODE_LENGTH, MAX_TOKENIZE_LINE } from "./highlighting/types";
const highlight = createHighlightEngine();
self.onmessage = async (event: MessageEvent<{ id: number; code: string; language: string }>) => {
  const { id, code, language } = event.data;
  const source = code.split("\n");
  if (code.length > MAX_CODE_LENGTH || source.length > 5000 || source.some(line => line.length > MAX_TOKENIZE_LINE)) {
    self.postMessage({ id, lines: null }); return;
  }
  const lines = await highlight(code, language);
  self.postMessage({ id, lines: lines && lines.reduce((count, line) => count + line.length, 0) <= 16_000 ? lines : null });
};
