import assert from "node:assert/strict";

export async function checkFonts(evaluate) {
  assert.match(await evaluate("getComputedStyle(document.body).fontFamily"), /^Inter(?:,|$)/);
  assert.match(await evaluate("getComputedStyle(document.querySelector('textarea')).fontFamily"), /^Inter(?:,|$)/);

  const faces = [
    '400 16px "Inter"',
    'italic 700 16px "Inter"',
    '400 16px "JetBrains Mono Nerd"',
    'italic 400 16px "JetBrains Mono Nerd"',
    '700 16px "JetBrains Mono Nerd"',
    'italic 700 16px "JetBrains Mono Nerd"',
  ];
  for (const face of faces) {
    assert.equal(await evaluate(`(async () => {
      const faces = await document.fonts.load(${JSON.stringify(face)});
      return faces.length > 0 && faces.every(face => face.status === 'loaded');
    })()`), true, `Could not load bundled font: ${face}`);
  }
}
