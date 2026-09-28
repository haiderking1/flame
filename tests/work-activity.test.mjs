import assert from 'node:assert/strict';
import test from 'node:test';
import { workActivity } from '../dist/backend/turns/work-activity.js';
const message = (text, phase) => ({ type: 'message', role: 'assistant', phase, content: [{ type: 'output_text', text }] });
const tool = { type: 'function_call', name: 'bash', call_id: 'call-1', arguments: JSON.stringify({ command: 'printf hello', background: false }) };
const result = { type: 'function_call_output', call_id: 'call-1', output: JSON.stringify({ job_id: 'job-1', status: 'exited', exit_code: 0, output: 'PRIVATE_TOOL_ENVELOPE' }) };

test('public work projection preserves narration/tool order, separates the final answer, and excludes private payloads', () => {
  const output = [{ type: 'reasoning', encrypted_content: 'PRIVATE_REASONING', summary: [{ text: 'PRIVATE_SUMMARY' }] },
    message('Checking.', 'commentary'), tool, result, message('Verified.', 'commentary'), message('The answer.', 'final_answer')];
  const view = workActivity('turn', 'Checking.\n\nVerified.\n\nThe answer.', output, 'completed', 100, 500);
  assert.deepEqual(view.steps.map(step => step.kind), ['message', 'tool', 'message']);
  assert.equal(view.steps[1].command, 'printf hello'); assert.equal(view.steps[1].jobId, 'job-1');
  assert.equal(view.answer, 'The answer.');
  assert.ok(!JSON.stringify(view).includes('PRIVATE_'));
  assert.equal(view.finishedAt, 500);
});

test('paragraph checkpoints stay inside live work without duplicating committed commentary; interrupted text is not a final answer', () => {
  const output = [message('Checking.'), tool, result];
  const view = workActivity('turn', 'Checking.\n\nNext paragraph.\n\n', output, 'running', 100, null);
  assert.equal(view.answer, '');
  assert.deepEqual(view.steps.filter(step => step.kind === 'message').map(step => step.text), ['Checking.', 'Next paragraph.\n\n']);
  const interrupted = workActivity('turn', 'Checking.', output, 'interrupted', 100, 500);
  assert.equal(interrupted.answer, '');
  assert.equal(workActivity('turn', 'Normal answer', [message('Normal answer')], 'completed', 100, 500), undefined);
});

test('tool failures remain inspectable and background notification boundaries do not turn progress into a final answer', () => {
  const failed = { ...result, output: JSON.stringify({ error: 'Execution was not confirmed.' }) };
  const output = [tool, message('Starting.'), failed, message('Waiting.'), { role: 'user', content: [{ type: 'input_text', text: 'PRIVATE_NOTIFICATION' }] }, message('Finished.')];
  const view = workActivity('turn', 'Starting.\n\nWaiting.\n\nFinished.', output, 'completed', 0, 100);
  assert.equal(view.answer, 'Finished.');
  assert.equal(view.steps[0].error, 'Execution was not confirmed.');
  assert.deepEqual(view.steps.filter(step => step.kind === 'message').map(step => step.text), ['Starting.', 'Waiting.']);
  assert.ok(!JSON.stringify(view).includes('PRIVATE_NOTIFICATION'));
});
