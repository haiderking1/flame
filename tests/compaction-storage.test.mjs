import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionDatabase } from '../dist/backend/sessions/database.js';
import { outputDigest } from '../dist/backend/sessions/context-items.js';

const settings = { modelId: 'fixture', effort: 'high', serviceTier: 'default' };
const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const reasoning = { type: 'reasoning', encrypted_content: 'opaque-secret', summary: [] };
const call = { type: 'function_call', name: 'write', call_id: 'call-one', arguments: '{"path":"file","content":"saved"}' };
const result = { type: 'function_call_output', call_id: call.call_id, output: '{"status":"completed"}' };
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'flame-compaction-storage-'));
  const file = join(root, 'session.sqlite'); writeFileSync(file, '', { mode: 0o600 });
  const location = { projectId: randomUUID(), sessionId: randomUUID() };
  let db = new SessionDatabase(file, location, settings);
  const h = { file, location, get db() { return db; }, restart() { db.close(); db = new SessionDatabase(file, location); } };
  h.append = text => db.append(db.read().revision, randomUUID(), text);
  h.turn = (text = 'Task') => { const id = randomUUID(); db.turns.start(db.read().revision, id, text, settings, 'account'); return id; };
  h.save = (extra = {}) => {
    const captured = db.compactions.capture(settings, 'account');
    return db.compactions.save({ expectedLeafId: captured.leafId, previousId: captured.checkpointId,
      summary: 'Goal: finish the task. Saved edits must not be replayed.', kept: [], modelId: settings.modelId, accountKey: 'account',
      tokensBefore: 1000, tokensAfter: 100, trigger: 'auto', ...extra });
  };
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return h;
}

test('checkpoints preserve transcript and drafts, survive restart, and keep their payload backend-only', t => {
  const h = setup(t), id = h.turn();
  h.db.turns.finish(id, 'completed', 'Answer', null, [reasoning, message('Answer')]);
  const before = h.db.history(null).entries;
  const captured = h.db.compactions.capture(settings, 'account');
  const draft = h.db.draft(h.db.read().revision, 'Keep my unsent draft');
  const cp = h.save({ expectedLeafId: captured.leafId, previousId: captured.checkpointId, kept: captured.input });
  assert.equal(h.db.read().revision, draft.revision, 'internal checkpoint does not conflict with draft saves');
  assert.deepEqual(h.db.history(null).entries, before);
  assert.equal(h.db.read().draft, draft.draft);
  assert.ok(JSON.stringify(h.db.compactions.capture(settings, 'account').input).includes('opaque-secret'));
  assert.ok(!JSON.stringify(h.db.history(null)).includes('opaque-secret'));
  assert.ok(!JSON.stringify(cp).includes('opaque-secret'));
  h.restart();
  const restored = h.db.compactions.capture(settings, 'account');
  assert.equal(restored.checkpointId, cp.id); assert.equal(restored.compactionCount, 1);
  assert.deepEqual(h.db.history(null).entries, before);
  assert.equal(h.db.history(null).compactions[0].id, cp.id);
});

test('incremental checkpoints include prior summary and preserve new suffix without duplicate transcript', t => {
  const h = setup(t); h.append('Original task'); const first = h.save();
  h.append('Latest correction');
  const input = h.db.compactions.capture(settings, 'account').input;
  assert.equal(input.length, 2); assert.match(input[0].content[0].text, /Goal: finish/);
  assert.equal(input[1].content[0].text, 'Latest correction');
  const second = h.save({ summary: 'Original task plus latest correction.', kept: [input[1]] });
  h.restart();
  const captured = h.db.compactions.capture(settings, 'account');
  assert.equal(captured.checkpointId, second.id); assert.equal(captured.compactionCount, 2);
  assert.equal(captured.input.length, 2); assert.equal(captured.input[1].content[0].text, 'Latest correction');
  assert.equal(h.db.history(null).entries.length, 2);
  assert.deepEqual(h.db.compactions.list().map(cp => cp.id), [first.id, second.id]);
});

test('active-turn offsets preserve original tool output and only replay the unsummarized completed suffix', t => {
  const h = setup(t), id = h.turn();
  const prefix = [reasoning, message('Checking'), call, result];
  h.db.turns.progress(id, 'Checking', prefix);
  const cp = h.save({ turnId: id, outputCount: prefix.length, outputDigest: outputDigest(prefix), kept: [call, result] });
  assert.equal(h.db.compactions.capture(settings, 'account').input.length, 3);
  const suffix = message('Done');
  h.db.turns.progress(id, 'Checking\n\nDone', [...prefix, suffix]);
  assert.deepEqual(h.db.compactions.capture(settings, 'account').input.at(-1), suffix);
  h.db.turns.finish(id, 'completed', 'Checking\n\nDone', null, [...prefix, suffix]);
  h.restart();
  const input = h.db.compactions.capture(settings, 'account').input;
  assert.equal(input.length, 4); assert.equal(input.at(-1).content[0].text, 'Done');
  assert.equal(h.db.compactions.list()[0].id, cp.id);
  const raw = new DatabaseSync(h.file);
  assert.deepEqual(JSON.parse(raw.prepare('SELECT output FROM turns WHERE id=?').get(id).output), [...prefix, suffix]); raw.close();
});

for (const status of ['failed', 'cancelled', 'interrupted']) test(`a ${status} active turn invalidates its checkpoint and falls back without tool replay`, t => {
  const h = setup(t); h.append('Older task'); const prior = h.save({ summary: 'Older task goal.' });
  const id = h.turn('Continue'), output = [call, result]; h.db.turns.progress(id, 'Changed file', output);
  const invalidated = h.save({ turnId: id, outputCount: output.length, kept: output });
  h.db.turns.finish(id, status, 'Changed file', 'Stopped', output);
  h.restart();
  const captured = h.db.compactions.capture(settings, 'account');
  assert.equal(captured.checkpointId, prior.id);
  assert.ok(!JSON.stringify(captured.input).includes(call.call_id));
  assert.match(captured.input.at(-1).content[0].text, /Response interrupted/);
  assert.ok(!h.db.compactions.list().some(cp => cp.id === invalidated.id));
});

for (const status of ['failed', 'cancelled', 'interrupted']) test(`a pre-inference checkpoint remains valid after its following response is ${status}`, t => {
  const h = setup(t); h.append('Original task');
  const id = h.turn('Continue');
  const user = h.db.compactions.capture(settings, 'account').input.at(-1);
  const cp = h.save({ turnId: id, outputCount: 0, kept: [user] });
  h.db.turns.finish(id, status, 'Partial output', 'Stopped', [message('Partial output')]);
  h.restart();
  const captured = h.db.compactions.capture(settings, 'account');
  assert.equal(captured.checkpointId, cp.id);
  assert.equal(captured.input[1].content[0].text, 'Continue');
  assert.match(captured.input.at(-1).content[0].text, /Partial output.*\n\[Response interrupted/);
});

test('persisted token anchors survive follow-ups and restart but fence scope, checkpoints and edited prefixes', t => {
  const h = setup(t), id = h.turn();
  const output = [reasoning, message('Done')]; h.db.turns.progress(id, 'Done', output);
  const meter = { estimatedTokens: 67000, contextWindow: 128000, thresholdTokens: 115200, compactionCount: 0, lastCompactedAt: null };
  assert.throws(() => h.db.turns.phase(id, 'responding', meter, -1), /Invalid context ledger/);
  assert.throws(() => h.db.turns.phase(id, 'responding', meter, 321, -1), /Invalid context instruction/);
  h.db.turns.phase(id, 'responding', meter, 321, 654); h.db.turns.finish(id, 'completed', 'Done', null, output);
  const prefix = h.db.compactions.capture(settings, 'account').input;
  h.append('Follow up'); h.restart();
  assert.deepEqual(h.db.compactions.capture(settings, 'account').tokenAnchor, { tokens: 67000, count: prefix.length, ledgerTokens: 321, overhead: 654 });
  assert.equal(h.db.compactions.capture(settings, 'another-account').tokenAnchor, undefined);
  assert.equal(h.db.compactions.capture({ ...settings, modelId: 'other' }, 'account').tokenAnchor, undefined);
  h.db.configure(h.db.read().revision, { ...settings, modelId: 'other' });
  assert.equal(h.db.read().context, undefined, 'a different model does not display the old model meter');
  h.db.configure(h.db.read().revision, settings);
  const raw = new DatabaseSync(h.file); raw.prepare('UPDATE turns SET output=? WHERE id=?').run(JSON.stringify([reasoning, message('Edited')]), id); raw.close();
  assert.equal(h.db.compactions.capture(settings, 'account').tokenAnchor, undefined);
  h.save(); assert.equal(h.db.compactions.capture(settings, 'account').tokenAnchor, undefined);
});

test('switching account or model strips opaque reasoning and converts tool calls into historical text', t => {
  const h = setup(t), id = h.turn(), output = [reasoning, call, result, message('Done')];
  h.db.turns.finish(id, 'completed', 'Done', null, output);
  h.save({ kept: output });
  for (const [selection, account] of [[{ ...settings, modelId: 'other' }, 'account'], [settings, 'other-account']]) {
    const input = h.db.compactions.capture(selection, account).input;
    assert.ok(!JSON.stringify(input).includes('opaque-secret'));
    assert.ok(!input.some(item => item.type === 'function_call' || item.type === 'function_call_output'));
    assert.match(JSON.stringify(input), /Historical tool record/);
  }
  assert.ok(JSON.stringify(h.db.compactions.capture({ ...settings, effort: 'low' }, 'account').input).includes('opaque-secret'));
});

test('stale leaves, competing checkpoint writes, wrong digests and incomplete tool boundaries cannot commit', t => {
  const h = setup(t); h.append('Task'); const captured = h.db.compactions.capture(settings, 'account');
  h.append('Concurrent message');
  assert.throws(() => h.save({ expectedLeafId: captured.leafId }), /changed while compacting/);
  const first = h.save();
  assert.throws(() => h.save({ previousId: null }), /changed while compacting/);
  const id = h.turn(), output = [call, result]; h.db.turns.progress(id, '', output);
  assert.throws(() => h.save({ turnId: id, outputCount: 1 }), /changed while compacting/);
  assert.throws(() => h.save({ turnId: id, outputCount: 2, outputDigest: 'wrong' }), /changed while compacting/);
  assert.throws(() => h.save({ kept: [call] }), /split a tool call/);
  h.db.turns.progress(id, '', [call]);
  assert.throws(() => h.save({ turnId: id, outputCount: 1 }), /Finish all tool results/);
  assert.deepEqual(h.db.compactions.list().map(cp => cp.id), [first.id]);
});

test('checkpoint insert failure leaves no partial state and manual operations add no chat entries', t => {
  const h = setup(t); h.append('Task');
  const raw = new DatabaseSync(h.file);
  raw.exec("CREATE TRIGGER fail_compaction BEFORE INSERT ON compactions BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  assert.throws(() => h.save()); assert.equal(h.db.compactions.list().length, 0);
  raw.exec('DROP TRIGGER fail_compaction'); raw.close();
  const before = h.db.history(null).entries, revision = h.db.read().revision, id = randomUUID();
  h.db.turns.manualStart(revision, id, settings, 'account');
  h.db.turns.phase(id, 'compacting', { estimatedTokens: 400, contextWindow: 1000, thresholdTokens: 900, compactionCount: 0, lastCompactedAt: null });
  assert.equal(h.db.turns.snapshot().operation, 'compaction'); assert.equal(h.db.turns.snapshot().phase, 'compacting');
  assert.equal(h.db.read().context.estimatedTokens, 400);
  h.save({ trigger: 'manual' });
  const finished = h.db.turns.manualFinish(id, 'completed', null);
  assert.equal(finished.revision, revision + 1); assert.deepEqual(h.db.history(null).entries, before);
  assert.equal(h.db.turns.snapshot().entryId, null);
  h.db.turns.manualStart(revision, id, settings, 'account'); assert.equal(h.db.read().revision, finished.revision);
});

test('manual operations are idle-fenced, reject empty conversations and recover as interrupted without chat rows', t => {
  const h = setup(t);
  assert.throws(() => h.db.turns.manualStart(0, randomUUID(), settings, 'account'), /Send a message/);
  h.append('Task'); const before = h.db.history(null).entries, id = randomUUID();
  h.db.turns.manualStart(h.db.read().revision, id, settings, 'account');
  assert.throws(() => h.db.configure(h.db.read().revision, { ...settings, effort: 'low' }), /Stop the active/);
  assert.throws(() => h.turn(), /Stop the active/);
  h.restart(); h.db.turns.recover();
  assert.equal(h.db.turns.snapshot().status, 'interrupted'); assert.equal(h.db.turns.snapshot().operation, 'compaction');
  assert.deepEqual(h.db.history(null).entries, before);
});

test('checkpoint lookup fences branches and detects cycles or corrupt active output prefixes', t => {
  const h = setup(t); h.append('Root'); const common = h.db.read().leafId;
  h.append('Branch A'); h.save();
  const raw = new DatabaseSync(h.file);
  raw.prepare('UPDATE session SET leaf_id=? WHERE singleton=1').run(common);
  h.append('Branch B'); assert.equal(h.db.compactions.capture(settings, 'account').checkpointId, null);
  const id = h.turn(); h.db.turns.progress(id, '', [message('Before')]); h.save({ turnId: id, outputCount: 1 });
  raw.prepare('UPDATE turns SET output=? WHERE id=?').run(JSON.stringify([message('Changed')]), id);
  assert.throws(() => h.db.compactions.capture(settings, 'account'), /storage safely/);
  raw.prepare('DELETE FROM compactions').run();
  const leaf = h.db.read().leafId; raw.prepare('UPDATE entries SET parent_id=? WHERE id=?').run(leaf, leaf);
  assert.throws(() => h.db.compactions.capture(settings, 'account'), /storage safely/); raw.close();
});

test('old histories larger than 8 MiB and 10,000 entries remain available to the compaction planner', t => {
  const h = setup(t), raw = new DatabaseSync(h.file);
  const insert = raw.prepare("INSERT INTO entries VALUES (?,?,?,'user',?,?,?)");
  raw.exec('BEGIN IMMEDIATE');
  let parent = null;
  for (let index = 0; index < 10020; index++) {
    const id = randomUUID(); insert.run(id, parent, index, index < 190 ? 'x'.repeat(48000) : `Message ${index}`, JSON.stringify(settings), randomUUID()); parent = id;
  }
  raw.prepare('UPDATE session SET leaf_id=?,revision=? WHERE singleton=1').run(parent, 10020); raw.exec('COMMIT'); raw.close();
  const captured = h.db.compactions.capture(settings, 'account');
  assert.equal(captured.input.length, 10020); assert.ok(Buffer.byteLength(JSON.stringify(captured.input)) > 8 * 1024 * 1024);
  h.save({ kept: [captured.input.at(-1)] }); h.restart();
  assert.equal(h.db.compactions.capture(settings, 'account').input.length, 2);
});

test('compaction and Read-image migrations preserve IDs and require valid compaction references', t => {
  const h = setup(t); h.append('Existing entry'); const before = h.db.read();
  const raw = new DatabaseSync(h.file);
  raw.exec(`DROP INDEX file_operations_image; ALTER TABLE file_operations DROP COLUMN image_id;
    DROP TABLE compactions; ALTER TABLE turns DROP COLUMN operation;
    ALTER TABLE turns DROP COLUMN phase; ALTER TABLE turns DROP COLUMN context;
    ALTER TABLE turns DROP COLUMN context_projection; ALTER TABLE session DROP COLUMN workspace; ALTER TABLE session DROP COLUMN workspace_setup; PRAGMA user_version=7;`);
  raw.close();
  h.restart(); assert.equal(h.db.read().leafId, before.leafId); assert.equal(h.db.read().revision, before.revision);
  const migrated = new DatabaseSync(h.file);
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 10);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []); migrated.close();
});
