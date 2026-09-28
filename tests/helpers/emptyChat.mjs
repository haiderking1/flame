import assert from 'node:assert/strict';

export async function checkEmptyChat(evaluate) {
  const state = await evaluate(`(() => {
    const heading = document.querySelector('.session-empty__heading');
    const composer = document.querySelector('.workspace__composer').getBoundingClientRect();
    const chat = document.querySelector('.workspace__chat').getBoundingClientRect();
    const title = heading?.getBoundingClientRect();
    return { text: heading?.textContent, centered: Math.abs(composer.top + composer.height / 2 - chat.top - chat.height / 2) < 1,
      gap: title ? composer.top - title.bottom : null,
      aligned: title ? Math.abs(title.left + title.width / 2 - composer.left - composer.width / 2) < 1 : false,
      fontSize: heading ? getComputedStyle(heading).fontSize : null,
      expectedSize: matchMedia('(min-width:640px)').matches ? '30px' : '24px',
      historyHidden: document.querySelector('.session-history').hidden };
  })()`);
  assert.equal(state.text, 'What are we cooking?');
  assert.ok(state.centered, 'empty composer is centered in the chat');
  assert.ok(state.aligned, 'heading shares the composer centerline');
  assert.ok(Math.abs(state.gap - 32) < 1, 'heading sits 32px above the composer');
  assert.equal(state.fontSize, state.expectedSize);
  assert.equal(state.historyHidden, true);
}
