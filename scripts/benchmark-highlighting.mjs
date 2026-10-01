import { cpus, totalmem } from 'node:os';
import { createHighlightEngine } from '../src/renderer/components/markdown/highlighting/engine.ts';
import { highlightBytes } from '../src/renderer/components/markdown/highlighting/types.ts';
import { parseDiffFromFile } from '@pierre/diffs';
import { retainedBytes } from '../src/renderer/components/workspace/code/cacheBudget.ts';
const samples = {
  rust: 'fn main() {\n    /* a multiline\n       comment */\n    println!("hello {}", 42);\n}\n',
  tsx: 'export function View({value}: {value: string}) {\n  return <div className="view">{`value: ${value}`}</div>;\n}\n',
  json: JSON.stringify({ name: 'sample', enabled: true, values: [1, 2, 3] }, null, 2) + '\n',
  bash: '#!/bin/bash\nset -euo pipefail\nfor file in *.ts; do\n  printf "%s\\n" "$file"\ndone\n',
};
const report = { hardware: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGiB: totalmem() / 1024 ** 3 }, node: process.version, samples: {} };
for (const [language, sample] of Object.entries(samples)) {
  const highlight = createHighlightEngine(), code = sample.repeat(40);
  let start = performance.now(); const tokens = await highlight(code, language); const coldMs = performance.now() - start;
  const warm = [];
  for (let i = 0; i < 20; i++) { start = performance.now(); await highlight(code, language); warm.push(performance.now() - start); }
  const longLines = [];
  for (const size of [1000, 2000, 5000, 20_000]) { start = performance.now(); await highlight(`${sample.split('\n')[0]} ${'x'.repeat(size)}`, language); longLines.push({ chars: size, ms: performance.now() - start }); }
  report.samples[language] = { sourceBytes: Buffer.byteLength(code), coldMs, warmMedianMs: warm.sort((a,b) => a-b)[10], warmP95Ms: warm[19], cacheBytes: highlightBytes(`${language}\0${code}`, tokens), longLines };
}
const content = Array.from({ length: 12_000 }, (_, i) => `export const value${i} = ${i};`).join('\n');
let start = performance.now(); const diff = parseDiffFromFile({ name: 'large.ts', contents: '' }, { name: 'large.ts', contents: content });
report.largeDiff = { lines: 12_000, ms: performance.now() - start, retainedBytes: retainedBytes(diff, 64 * 1024 * 1024) };
console.log(JSON.stringify(report, null, 2));
