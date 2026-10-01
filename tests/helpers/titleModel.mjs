/** A thread title request from Flame's text model, which shares the fake model with the chat in UI tests. */
export const isTitleRequest = body => typeof body.instructions === 'string' && body.instructions.startsWith('You write concise titles');
/** Answers a title request with the given title; the default keeps the first message as the thread's title. */
export function titleReply(title = 'New thread', needsRefinement = false) {
  const text = JSON.stringify({ title, needsRefinement });
  const events = [{ type: 'response.output_item.done', output_index: 0, item: { id: 'title', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
    { type: 'response.completed', response: { status: 'completed', output: [] } }];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
}
/** The same for fakes of the inference client's `run`. */
export const isTitleRun = request => typeof request.instructionsOverride === 'string' && request.instructionsOverride.startsWith('You write concise titles');
export function titleResult(title = 'New thread', needsRefinement = false) {
  const text = JSON.stringify({ title, needsRefinement });
  return { text, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] };
}
