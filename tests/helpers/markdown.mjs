import assert from 'node:assert/strict';
export const markdownSample = '\n## Summary\n\n**Ready** with `inline code` and *emphasis*.\n\n- One\n  - Nested\n- Two\n\n- [x] Complete\n- [ ] Pending\n\n> A useful note.\n\n| Name | Value |\n| --- | --- |\n| Mode | Dark |\n\n[Documentation](https://example.com/docs)\n\n[Unsafe](javascript:alert(1))\n\n![Remote image](https://example.com/pixel.png)\n\n<script>window.markdownExecuted = true</script>\n\n```unknown-language\n<script>literal code</script>\n```\n';
export async function checkMarkdown({ evaluate, wait, click }) {
  await evaluate("document.querySelector('.markdown-code').scrollIntoView({block:'center'})");
  await wait("document.querySelector('.markdown-code__line span')?.style.color");
  assert.ok(await evaluate("new Set([...document.querySelectorAll('.markdown-code__line span')].map(node => getComputedStyle(node).color)).size > 1"), 'code is actually highlighted under production CSP');
  assert.ok(await evaluate("document.querySelector('.markdown h2').textContent === 'Summary' && document.querySelector('.markdown strong').textContent === 'Ready'"));
  assert.ok(await evaluate("!!document.querySelector('.markdown ul ul li') && !!document.querySelector('.markdown input[type=checkbox]:checked:disabled') && !!document.querySelector('.markdown blockquote') && !!document.querySelector('.markdown-table td')"));
  assert.ok(await evaluate("!window.markdownExecuted && !document.querySelector('.markdown script, .markdown img, .markdown iframe, .markdown a[href^=javascript]')"), 'untrusted HTML, unsafe links and automatic image loads remain inert');
  assert.ok(await evaluate("[...document.querySelectorAll('.markdown-code pre')].some(node => node.textContent.includes('<script>literal code</script>'))"), 'unknown languages retain readable source');
  await evaluate("window.originalClipboardWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = async text => { window.copiedCode = text; }; true");
  try {
    await click('[aria-label="Copy code"]');
    await wait("window.copiedCode === 'const value = 1;\\n' && document.querySelector('.markdown-code__feedback').textContent === 'Copied'");
    await evaluate("navigator.clipboard.writeText = async () => { throw new Error('denied'); }; true");
    await click('[aria-label="Copy code"]');
    await wait("document.querySelector('.markdown-code__feedback').textContent === 'Could not copy'");
  } finally { await evaluate("navigator.clipboard.writeText = window.originalClipboardWrite; delete window.originalClipboardWrite"); }
  await click('[aria-label="Wrap code"]');
  assert.ok(await evaluate("document.querySelector('.markdown-code').dataset.wrap === 'true' && getComputedStyle(document.querySelector('.markdown-code pre')).whiteSpace === 'pre-wrap'"));
  await click('[aria-label="Wrap code"]');
}
