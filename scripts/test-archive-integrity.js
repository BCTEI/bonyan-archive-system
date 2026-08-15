// Smoke test for the archive data-integrity changes (suspend-instead-of-delete,
// CSV attachments, incoming-doc receiver). Runs inside Electron's main process
// against a throwaway userData dir so the real archive.db is never touched.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonyan-test-'));
app.setPath('userData', tmp);

let failures = 0;
function check(name, cond) {
  console.log(`[Test] ${cond ? 'PASS' : 'FAIL'} — ${name}`);
  if (!cond) failures++;
}

app.whenReady().then(async () => {
  const db = require(path.join(__dirname, '../dist/electron/database.js'));
  const init = db.initDb();
  check('DB init', init.success === true);

  // ── Create an INCOMING document with sender AND receiver + CSV attachment ──
  const ref = db.generateArchiveRefNumber(1);
  check('ref number generated (م.ب/…)', /^م\.ب\/\d+\/1$/.test(ref.ref_number));

  const csvAttachment = [{ name: 'تقرير', ext: 'csv', size: 128, base64: Buffer.from('a,b,c\n1,2,3').toString('base64') }];
  db.run(`INSERT INTO documents (ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, date, status, attachments_json, archive_year)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ref.ref_number, 2, 1, 'عادي', 'وثيقة واردة تجريبية', 'وزارة الدفاع', 'الإدارة العامة', '2026-08-14', 'قيد الاعتماد', JSON.stringify(csvAttachment), ref.year]);

  let rows = db.query('SELECT * FROM documents WHERE ref_number = ?', [ref.ref_number]);
  check('incoming doc saved with receiver', rows.length === 1 && rows[0].receiver === 'الإدارة العامة');
  const atts = JSON.parse(rows[0].attachments_json);
  check('CSV attachment stored with correct ext', atts.length === 1 && atts[0].ext === 'csv' && atts[0].name === 'تقرير');

  const docId = rows[0].id;

  // ── Suspend (the exact SQL now used by the document:delete IPC handler) ──
  db.run("UPDATE documents SET status = 'موقوف', updated_at = strftime('%s','now') WHERE id = ?", [docId]);
  rows = db.query('SELECT * FROM documents WHERE id = ?', [docId]);
  check('row still exists after suspend (no physical delete)', rows.length === 1);
  check('status is موقوف', rows[0].status === 'موقوف');
  check('ref_number unchanged after suspend', rows[0].ref_number === ref.ref_number);
  check('attachments preserved after suspend', JSON.parse(rows[0].attachments_json)[0].ext === 'csv');

  // ── Active vs suspended listing semantics ──
  const active = db.query("SELECT id FROM documents WHERE status != 'موقوف'", []);
  const suspended = db.query("SELECT id FROM documents WHERE status = 'موقوف'", []);
  check('suspended doc hidden from active list', active.every(r => r.id !== docId));
  check('suspended doc findable when included', suspended.some(r => r.id === docId));

  // ── Audit entry written like the handler does ──
  db.addAudit('إيقاف وثيقة', ref.ref_number, 'وثيقة واردة تجريبية — الحالة السابقة: قيد الاعتماد، الحالة الجديدة: موقوف', 'admin');
  const audit = db.query("SELECT * FROM audit_log WHERE action = 'إيقاف وثيقة' AND doc_ref = ?", [ref.ref_number]);
  check('suspend audited with ref + prev/new status', audit.length === 1 && audit[0].details.includes('الحالة السابقة'));

  // ── Reference numbering still monotonic after suspension ──
  const ref2 = db.generateArchiveRefNumber(1);
  check('next ref increments (no reuse after suspend)', ref2.sequence_number === ref.sequence_number + 1);

  console.log(failures === 0 ? '[Test] ALL PASSED' : `[Test] ${failures} FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
