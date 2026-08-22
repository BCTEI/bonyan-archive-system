const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

app.whenReady().then(async () => {
  // Isolate: all DB paths derive from userData — redirect BEFORE requiring database.js.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bonyan-backup-test-'));
  app.setPath('userData', sandbox);

  const db = require(path.join(__dirname, '../dist/electron/database.js'));
  const backup = require(path.join(__dirname, '../dist/electron/backup.js'));

  const fail = (msg) => { console.error('[FAIL]', msg); app.exit(1); };
  process.on('uncaughtException', (e) => fail(e.stack || String(e)));

  try {
    assert.strictEqual(db.initDb().success, true, 'initDb');
    // Seed one recognizable document (folders/types/admin are auto-seeded).
    db.run(`INSERT INTO documents (ref_number, type_id, folder_id, subject, date, status)
            VALUES ('م.ب/999/1', 1, 1, 'roundtrip-test', '2026-08-22', 'قيد الاعتماد')`);
    const before = db.query('SELECT COUNT(*) c FROM documents')[0].c;
    assert.ok(before >= 1);

    const dest = path.join(sandbox, 'test.bonyan-backup');
    const progress = [];
    const { sizeBytes, sha256 } = await backup.exportBackup(dest, 'test-passphrase-1', { appVersion: '0.0.0-test', createdBy: 'tester' }, p => progress.push(p));
    assert.ok(fs.existsSync(dest) && sizeBytes > 100, 'export file written');
    assert.strictEqual(progress[progress.length - 1], 100, 'progress reaches 100');

    const header = backup.readBackupHeader(dest);
    assert.strictEqual(header.formatVersion, 1);
    assert.strictEqual(header.manifest.counts.documents, before);
    assert.strictEqual(header.manifest.sha256, sha256);

    // Wrong passphrase must fail with AUTH.
    await assert.rejects(
      backup.restoreBackup(dest, 'wrong-passphrase-1', () => {}),
      (e) => e.code === 'AUTH'
    );

    // Bit-flip inside the ciphertext must fail with AUTH (tamper detection).
    const tampered = path.join(sandbox, 'tampered.bonyan-backup');
    fs.copyFileSync(dest, tampered);
    const fd = fs.openSync(tampered, 'r+');
    const pos = header.dataOffset + 10;
    const byte = Buffer.alloc(1);
    fs.readSync(fd, byte, 0, 1, pos);
    byte[0] ^= 0xff;
    fs.writeSync(fd, byte, 0, 1, pos);
    fs.closeSync(fd);
    await assert.rejects(backup.restoreBackup(tampered, 'test-passphrase-1', () => {}), (e) => e.code === 'AUTH');

    // Tamper-evidence for the live DB: delete the seeded row AFTER export, then restore.
    db.run("DELETE FROM documents WHERE ref_number = 'م.ب/999/1'");
    assert.strictEqual(db.query("SELECT COUNT(*) c FROM documents WHERE ref_number = 'م.ب/999/1'")[0].c, 0);
    await backup.restoreBackup(dest, 'test-passphrase-1', () => {});
    const reopened = db.initDb();
    assert.strictEqual(reopened.success, true, 'reopen after restore');
    const restored = db.query("SELECT COUNT(*) c FROM documents WHERE ref_number = 'م.ب/999/1'")[0].c;
    assert.strictEqual(restored, 1, 'seeded document survives the round-trip');
    const safetyDir = path.join(sandbox, 'backups');
    assert.ok(fs.existsSync(safetyDir) && fs.readdirSync(safetyDir).some(f => f.startsWith('pre_restore_')), 'safety copy created');

    console.log('[PASS] backup round-trip: export, wrong-pass, tamper, restore, safety copy — all OK');
  } catch (err) {
    fail(err.stack || String(err));
    return;
  }
  app.quit();
});
