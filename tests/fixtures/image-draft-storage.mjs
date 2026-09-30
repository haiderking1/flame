import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const filename = join(app.getPath('userData'), 'draft-storage.html');
  writeFileSync(filename, '<!doctype html><title>Image draft storage regression</title>');
  const window = new BrowserWindow({ show: false, frame: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(filename); window.show();
  const source = readFileSync(process.env.FLAME_DRAFT_TEST_SOURCE, 'utf8');
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      ${source}
      const make = name => ({ id: crypto.randomUUID(), name, file: new Blob([name], { type: 'image/png' }) });
      const original = make('original.png'), added = make('added.png'), newer = make('newer.png');
      const scope = 'accepted-cleanup';
      await saveImageDraft(scope, [original]);
      const older = stageImageDraft(scope, [original, added]);
      const baseTransaction = IDBDatabase.prototype.transaction;
      let began;
      const started = new Promise(resolve => { began=resolve; });
      IDBDatabase.prototype.transaction = function(stores, mode, options) {
        const transaction = baseTransaction.call(this, stores, mode, options);
        if (mode === 'readwrite') { IDBDatabase.prototype.transaction=baseTransaction; began(); }
        return transaction;
      };
      const oldWrite = saveImageDraft(scope, older);
      await started;
      const cleanup = removeAcceptedImageDraft(scope, [original.id]);
      const latest = stageImageDraft(scope, [original, added, newer]);
      const newWrite = saveImageDraft(scope, latest);
      const oldReturned = (await oldWrite).map(image => image.id);
      const newestSurvivesOldWrite = pendingImageDraft(scope) === latest;
      await cleanup;
      const newestSurvivesCleanup = pendingImageDraft(scope) === latest;
      await newWrite;
      const afterCleanup = (await readImageDraft(scope)).map(image => image.id);
      await saveImageDraft(scope, [original, added, newer]);
      const lateWriterCannotRestoreAccepted = (await readImageDraft(scope)).map(image => image.id);
      const inheritedScope = 'inherited-save';
      const inherited = stageImageDraft(inheritedScope, [newer]);
      let inheritedSettled = false;
      const stop = watchImageDraft(inheritedScope, () => { inheritedSettled = pendingImageDraft(inheritedScope) !== inherited; });
      const inheritedWrite = saveImageDraft(inheritedScope, inherited);
      const inheritedSaving = isImageDraftSaving(inheritedScope);
      await inheritedWrite; stop();
      const inheritedFinished = !isImageDraftSaving(inheritedScope);
      const failedScope = 'failed-write';
      const retained = stageImageDraft(failedScope, [added]);
      const transaction = IDBDatabase.prototype.transaction;
      let rejectWrite = true;
      IDBDatabase.prototype.transaction = function(stores, mode, options) {
        if (mode === 'readwrite' && rejectWrite) { rejectWrite=false; throw new DOMException('Simulated storage failure', 'QuotaExceededError'); }
        return transaction.call(this, stores, mode, options);
      };
      let failed = false;
      let failureNotified = false;
      const stopFailure = watchImageDraft(failedScope, () => {
        if (pendingImageDraft(failedScope) === retained && !isImageDraftSaving(failedScope)) failureNotified = true;
      });
      try { await saveImageDraft(failedScope, retained); } catch { failed=true; }
      stopFailure();
      const failedDraftRetained = pendingImageDraft(failedScope) === retained;
      IDBDatabase.prototype.transaction = transaction;
      await saveImageDraft(failedScope, retained);
      const failedCleanupScope = 'failed-accepted-cleanup';
      await saveImageDraft(failedCleanupScope, [original,newer]);
      let visibleIds=[original.id,newer.id];
      const unwatch=watchImageDraft(failedCleanupScope, () => { visibleIds=remainingImageDraft(failedCleanupScope,[original,newer]).map(image=>image.id); });
      rejectWrite=true;
      IDBDatabase.prototype.transaction = function(stores, mode, options) {
        if (mode === 'readwrite' && rejectWrite) { rejectWrite=false; throw new DOMException('Simulated cleanup failure', 'QuotaExceededError'); }
        return transaction.call(this, stores, mode, options);
      };
      let cleanupFailed=false;
      try { await removeAcceptedImageDraft(failedCleanupScope,[original.id]); } catch { cleanupFailed=true; }
      IDBDatabase.prototype.transaction=transaction; unwatch();
      const failedRemainder=(pendingImageDraft(failedCleanupScope) ?? []).map(image=>image.id);
      await saveImageDraft(failedCleanupScope,pendingImageDraft(failedCleanupScope));
      return { newestSurvivesOldWrite, newestSurvivesCleanup, afterCleanup, lateWriterCannotRestoreAccepted,
        expected:[added.id,newer.id], inheritedSettled, inheritedSaving, inheritedFinished, failureNotified, inheritedClean:pendingImageDraft(inheritedScope) === undefined,
        failed, failedDraftRetained, retryClean:pendingImageDraft(failedScope) === undefined, oldReturned, expectedOld:[added.id],
        cleanupFailed,visibleIds,failedRemainder,expectedRemainder:[newer.id] };
    })()`, true);
    assert.equal(result.newestSurvivesOldWrite, true, 'old completion cannot clear a newer pending draft');
    assert.equal(result.newestSurvivesCleanup, true, 'accepted cleanup cannot clear a newer pending draft');
    assert.deepEqual(result.afterCleanup, result.expected, 'cleanup preserves attachments added while send completes');
    assert.deepEqual(result.lateWriterCannotRestoreAccepted, result.expected, 'late writers cannot resurrect accepted IDs');
    assert.deepEqual(result.oldReturned,result.expectedOld,'transaction begun before acceptance returns a fenced draft');
    assert.equal(result.inheritedSettled, true, 'durable completion notifies the new owner to reconcile its inherited draft');
    assert.equal(result.inheritedClean, true);
    assert.equal(result.inheritedSaving, true, 'a new owner can distinguish an active save from an unsaved failure');
    assert.equal(result.inheritedFinished, true);
    assert.equal(result.failureNotified, true, 'failed saves notify the inherited owner after the write stops');
    assert.equal(result.failed, true); assert.equal(result.failedDraftRetained, true); assert.equal(result.retryClean, true);
    assert.equal(result.cleanupFailed,true);
    assert.deepEqual(result.visibleIds,result.expectedRemainder,'accepted thumbnails disappear even if local cleanup fails');
    assert.deepEqual(result.failedRemainder,result.expectedRemainder,'failed cleanup preserves unsaved new attachment for retry');
    console.log('FLAME_IMAGE_DRAFT_STORAGE_OK');
  } finally { window.destroy(); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
