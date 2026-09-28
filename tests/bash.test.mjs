import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BashJobs } from '../dist/backend/bash/jobs.js';

const request = (command) => ({ command, cwd: process.cwd(), env: { PATH: '/usr/bin:/bin' } });
async function drained(jobs, id) {
  while (!jobs.snapshot(id).outputClosed) await once(jobs, 'outputClosed');
  return jobs.snapshot(id);
}
async function output(jobs, id) {
  while (!jobs.snapshot(id).output.text.trim()) await new Promise(resolve => setTimeout(resolve, 5));
  return jobs.snapshot(id).output.text.trim();
}
const options = { timeout: 5000, skip: process.platform === 'win32' }; // Test watchdog, never a command deadline.

test('Bash reports nonzero exit and spawn failure without exposing raw environment errors', options, async () => {
  const jobs = new BashJobs();
  try {
    const id = jobs.start(request('printf "failure details" >&2; exit 7'));
    const result = await jobs.wait(id);
    assert.equal(result.status, 'exited'); assert.equal(result.exitCode, 7);
    assert.equal((await drained(jobs, id)).output.text, 'failure details');
    const missing = jobs.start({ ...request('true'), cwd: '/this-directory-must-not-exist-flame-test' });
    const failure = await jobs.wait(missing);
    assert.equal(failure.status, 'failed'); assert.match(failure.error, /Could not start Bash/);
  } finally { jobs.close(); }
});

test('shell failure completes despite inherited pipes and cleans up ordinary descendants', options, async () => {
  const jobs = new BashJobs();
  try {
    const id = jobs.start(request('sleep 60 & printf "%s\\n" "$!"; exit 9'));
    const result = await jobs.wait(id);
    assert.equal(result.exitCode, 9);
    const closed = await drained(jobs, id);
    assert.equal(closed.outputClosed, true);
    assert.match(closed.output.text.trim(), /^\d+$/);
  } finally { jobs.close(); }
});

test('explicit Stop kills the owned process group and reports the actual termination signal', options, async () => {
  const jobs = new BashJobs();
  try {
    const id = jobs.start(request('sleep 60 & printf "%s\\n" "$!"; wait'));
    const descendant = Number(await output(jobs, id));
    jobs.stop(id);
    const result = await jobs.wait(id);
    assert.equal(result.status, 'cancelled'); assert.equal(result.signal, 'SIGKILL');
    await drained(jobs, id);
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${descendant}/stat`, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat) assert.match(stat, /\) [ZX] /, 'descendant must not remain running');
    }
  } finally { jobs.close(); }
});

test('managed background completion is delivered once and retained until acknowledged, without rerunning', options, async () => {
  const jobs = new BashJobs();
  try {
    const notifications = [];
    jobs.on('completed', id => notifications.push(id));
    const id = jobs.start(request('printf ready; sleep 0.05; printf done'));
    assert.equal(jobs.snapshot(id).status, 'running');
    await jobs.wait(id); await drained(jobs, id);
    assert.deepEqual(notifications, [id]);
    assert.equal(jobs.notifications()[0].output.text, 'readydone');
    await jobs.wait(id);
    assert.deepEqual(notifications, [id]);
    jobs.acknowledge(id); assert.deepEqual(jobs.notifications(), []);
    jobs.release(id); assert.throws(() => jobs.snapshot(id), /not found/);
  } finally { jobs.close(); }
});

test('noisy output is drained with a bounded UTF-8 tail rather than blocking a process', options, async () => {
  const jobs = new BashJobs();
  try {
    const id = jobs.start(request('head -c 1048576 /dev/zero | tr "\\0" x; printf "😀end"'));
    await jobs.wait(id);
    const result = await drained(jobs, id);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.bytes, 1048576 + 7);
    assert.ok(result.output.truncated); assert.ok(Buffer.byteLength(result.output.text) <= 65536);
    assert.ok(result.output.text.endsWith('😀end'));
  } finally { jobs.close(); }
});

test('validation, concurrency bounds and shutdown prevent uncontrolled launches', options, async () => {
  const jobs = new BashJobs();
  try {
    assert.throws(() => jobs.start({ ...request('true'), env: { BAD: '\0' } }), /environment/);
    assert.throws(() => jobs.start({ ...request('true'), cwd: '.' }), /absolute/);
    const ids = Array.from({ length: 4 }, () => jobs.start(request('sleep 60')));
    assert.throws(() => jobs.start(request('true')), /four/);
    assert.throws(() => jobs.release(ids[0]), /Cannot release/);
    jobs.close();
    assert.throws(() => jobs.start(request('true')), /closed/);
    const results = await Promise.all(ids.map(id => jobs.wait(id)));
    assert.ok(results.every(result => result.status === 'cancelled'));
  } finally { jobs.close(); }
});
