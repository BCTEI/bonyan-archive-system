# External Encrypted Backup & Restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GM-only feature that exports the entire archive (including closed-year tables) to a single encrypted `.bonyan-backup` file on an external drive, and restores it back with full verification and automatic rollback.

**Architecture:** New `electron/backup.ts` module owns the binary format + crypto (scrypt → AES-256-GCM over gzip, streamed); `database.ts` gains three tiny exports; five GM-gated IPC channels + one progress event connect it to a new Angular page «النسخ الاحتياطي الخارجي». Restore decrypts and validates fully before touching the live DB, then swaps files and relaunches via an explicit user action.

**Tech Stack:** Electron 30 main process (Node `crypto`/`zlib`/`fs` streams — no new dependencies), better-sqlite3 11.6 (`db.backup()`), Angular 17 standalone component + signals, Angular Material + Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-22-external-backup-restore-design.md` — read it first; the plan argues from it.

## Global Constraints

- **No new npm dependencies.** Everything uses Node built-ins (`crypto`, `zlib`, `stream`, `fs`) or existing deps.
- **No git mutations** (no `git add`/`commit`/`tag`/`push`) unless the user explicitly asks for them. Where a generic workflow would say "commit", the executor instead reports files changed and moves on.
- All user-facing strings and IPC error messages are **Arabic** (RTL); code identifiers and code comments are **English**.
- Authorization is enforced in the **main process** on every channel via `activeUser()` + `hasMinRole(user, 'general_manager')` — renderer guards are convenience only (AGENTS.md rule).
- New IPC surface touches **four places together**: `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`, `src/app/services/backup.service.ts` (AGENTS.md rule).
- Package manager is **bun**; verification commands: `bunx tsc -p electron/tsconfig.json --noEmit` (Electron side), `bun run build:prod` (both), `bun run test:login` (smoke), `electron scripts/test-backup-roundtrip.js` (feature test).
- `database.ts` changes are **additive only** — no schema changes, no behavioral change to existing exports.

---

### Task 1: database.ts primitives (getDbPath / closeDatabase / createDbSnapshot)

**Files:**
- Modify: `electron/database.ts` (module state at :244-247, `initDb` at :249; append exports near `query`/`run` at :1079-1095)

**Interfaces:**
- Consumes: existing module state `db: Database.Database | null`, `dbPath: string | null`, `useMemoryFallback: boolean`; `initDb()`.
- Produces (used by Task 2's `electron/backup.ts`):
  - `export function getDbPath(): string` — returns the live DB path, computing it from `app.getPath('userData')` if `initDb` hasn't run yet.
  - `export function closeDatabase(): void` — closes the handle and nulls `db` so a later `initDb()` reopens the file (Windows file-lock release for the restore swap).
  - `export function createDbSnapshot(destPath: string): Promise<void>` — thin wrapper over better-sqlite3's online `db.backup(destPath)`; throws the Arabic fallback message in memory-fallback mode.

- [ ] **Step 1: Add the three exports**

In `electron/database.ts`, immediately after the existing `run()` export (line ~1095), add:

```ts
/** Absolute path of the live SQLite file. Falls back to the conventional
 *  location when initDb() has not run yet (e.g. early dialog use). */
export function getDbPath(): string {
  return dbPath ?? path.join(app.getPath('userData'), 'archive.db');
}

/** Closes the SQLite handle so the file can be replaced on Windows (open
 *  handles lock the file). A later initDb() call reopens it transparently. */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Consistent online snapshot of the live database via better-sqlite3's
 *  backup API — safe to call while the app is running. */
export async function createDbSnapshot(destPath: string): Promise<void> {
  if (useMemoryFallback || !db) throw new Error('النسخ الاحتياطي غير مدعوم في وضع الذاكرة المؤقت');
  await db.backup(destPath);
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc -p electron/tsconfig.json --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Report** — list changed files. No commit (global constraint).

---

### Task 2: electron/backup.ts — format, crypto, export/restore core (TDD via round-trip script)

**Files:**
- Create: `electron/backup.ts`
- Create: `scripts/test-backup-roundtrip.js`

**Interfaces:**
- Consumes (Task 1): `getDbPath()`, `closeDatabase()`, `createDbSnapshot(destPath)`, plus existing `initDb()` and `query(sql, params?)` from `electron/database.ts`.
- Produces (used by Task 3's IPC handlers and the test script):
  - `export class BackupError extends Error { readonly code: 'NOT_BACKUP' | 'FORMAT_TOO_NEW' | 'AUTH' | 'CORRUPT' | 'IO' }`
  - `export interface BackupManifest { app: string; appVersion: string; createdAt: string; createdBy: string; dbSizeBytes: number; sha256: string; counts: { documents: number; archivedYears: number; folders: number; users: number } }`
  - `export interface BackupHeader { manifest: BackupManifest; formatVersion: number; kdf: { N: number; r: number; p: number }; salt: Buffer; nonce: Buffer; dataOffset: number; fileSize: number }`
  - `export const BACKUP_EXTENSION = '.bonyan-backup'`
  - `export function readBackupHeader(filePath: string): BackupHeader` — throws `BackupError('NOT_BACKUP' | 'FORMAT_TOO_NEW')`.
  - `export function compareVersions(a: string, b: string): number` — numeric semver compare (`1.10.0 > 1.9.0`); negative/0/positive.
  - `export async function exportBackup(destPath: string, passphrase: string, meta: { appVersion: string; createdBy: string }, onProgress: (percent: number) => void): Promise<{ sizeBytes: number; sha256: string }>`
  - `export async function restoreBackup(filePath: string, passphrase: string, onProgress: (percent: number) => void): Promise<BackupManifest>`

File layout (see spec §4): `magic "BONYANBK"(8) | version(1) | manifestLen u32LE(4) | manifest JSON | kdfN/kdfR/kdfP u32LE(12) | saltLen(1)+salt(32) | nonceLen(1)+nonce(12) | ciphertext = AES-256-GCM(gzip(sqlite)) | gcmTag(16, EOF)`.

- [ ] **Step 1: Write the failing round-trip test**

Create `scripts/test-backup-roundtrip.js` (runs in Electron's main process, like `test-login.js`, but redirects `userData` to a temp dir so the real DB is never touched):

```js
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

  const fail = (msg) => { console.error('[FAIL]', msg); process.exitCode = 1; app.quit(); };
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run build:electron && electron scripts/test-backup-roundtrip.js`
Expected: FAIL — `Cannot find module '.../dist/electron/backup.js'`.

- [ ] **Step 3: Implement `electron/backup.ts`**

Complete implementation:

```ts
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { query, getDbPath, closeDatabase, createDbSnapshot, initDb } from './database';

// ── Format (spec §4) ─────────────────────────────────────────────────────────
const MAGIC = Buffer.from('BONYANBK', 'ascii');
const FORMAT_VERSION = 1;
const KDF = { N: 16384, r: 8, p: 1 } as const;
const SALT_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const MAX_MANIFEST_LEN = 64 * 1024;

export const BACKUP_EXTENSION = '.bonyan-backup';

export type BackupErrorCode = 'NOT_BACKUP' | 'FORMAT_TOO_NEW' | 'AUTH' | 'CORRUPT' | 'IO';

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupManifest {
  app: string;
  appVersion: string;
  createdAt: string;
  createdBy: string;
  dbSizeBytes: number;
  sha256: string;
  counts: { documents: number; archivedYears: number; folders: number; users: number };
}

export interface BackupHeader {
  manifest: BackupManifest;
  formatVersion: number;
  kdf: { N: number; r: number; p: number };
  salt: Buffer;
  nonce: Buffer;
  dataOffset: number;
  fileSize: number;
}

/** Numeric semver-ish compare: negative when a < b, 0 equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};

function deriveKey(passphrase: string, salt: Buffer, kdf: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (d: Buffer) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** Reads and validates the (plaintext) header; never touches the ciphertext. */
export function readBackupHeader(filePath: string): BackupHeader {
  const invalid = () => new BackupError('NOT_BACKUP', 'الملف المحدد ليس نسخة احتياطية صالحة من هذا النظام');
  const fileSize = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  let offset = 0;
  const read = (len: number): Buffer => {
    const b = Buffer.alloc(len);
    if (fs.readSync(fd, b, 0, len, offset) !== len) throw invalid();
    offset += len;
    return b;
  };
  try {
    if (!read(8).equals(MAGIC)) throw invalid();
    const formatVersion = read(1)[0];
    if (formatVersion > FORMAT_VERSION) {
      throw new BackupError('FORMAT_TOO_NEW', 'إصدار النسخة أحدث مما يدعمه التطبيق — حدّث التطبيق أولاً');
    }
    const manifestLen = read(4).readUInt32LE(0);
    if (manifestLen === 0 || manifestLen > MAX_MANIFEST_LEN) throw invalid();
    const manifest = JSON.parse(read(manifestLen).toString('utf8')) as BackupManifest;
    if (manifest.app !== 'bonyan-archive-system' || typeof manifest.sha256 !== 'string') throw invalid();
    const kdf = { N: read(4).readUInt32LE(0), r: read(4).readUInt32LE(0), p: read(4).readUInt32LE(0) };
    if (kdf.N < 1024 || kdf.N > 1 << 20 || kdf.r < 1 || kdf.p < 1) throw invalid();
    const salt = read(read(1)[0]);
    const nonce = read(read(1)[0]);
    if (salt.length < 16 || nonce.length !== NONCE_LEN) throw invalid();
    return { manifest, formatVersion, kdf, salt, nonce, dataOffset: offset, fileSize };
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw invalid(); // JSON.parse / readSync failures all mean "not a backup"
  } finally {
    fs.closeSync(fd);
  }
}

function collectCounts(): BackupManifest['counts'] {
  const c = (sql: string): number => (query(sql) as Array<{ c: number }>)[0].c;
  return {
    documents: c('SELECT COUNT(*) c FROM documents'),
    archivedYears: c('SELECT COUNT(*) c FROM archived_years'),
    folders: c('SELECT COUNT(*) c FROM folders'),
    users: c('SELECT COUNT(*) c FROM users')
  };
}

function mapWriteError(err: unknown): never {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') throw new BackupError('IO', 'مساحة غير كافية على القرص المحدد');
  throw new BackupError('IO', 'تعذر الكتابة إلى الوجهة المحددة — تحقق من توصيل القرص والصلاحيات');
}

/**
 * Snapshot → SHA-256 → header → stream gzip+encrypt to `<dest>.part` → rename.
 * Progress reports plaintext bytes read / snapshot size, capped at 99% until
 * the rename lands (spec §5). The live DB is never modified.
 */
export async function exportBackup(
  destPath: string,
  passphrase: string,
  meta: { appVersion: string; createdBy: string },
  onProgress: (percent: number) => void
): Promise<{ sizeBytes: number; sha256: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonyan-backup-'));
  const snapshot = path.join(tmpDir, 'snapshot.db');
  const partPath = destPath + '.part';
  try {
    await createDbSnapshot(snapshot);
    const sha256 = await sha256File(snapshot);
    const dbSizeBytes = fs.statSync(snapshot).size;
    const manifest: BackupManifest = {
      app: 'bonyan-archive-system',
      appVersion: meta.appVersion,
      createdAt: new Date().toISOString(),
      createdBy: meta.createdBy,
      dbSizeBytes,
      sha256,
      counts: collectCounts()
    };
    const salt = crypto.randomBytes(SALT_LEN);
    const nonce = crypto.randomBytes(NONCE_LEN);
    const key = await deriveKey(passphrase, salt, KDF);

    const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
    fs.writeFileSync(partPath, Buffer.concat([
      MAGIC, Buffer.from([FORMAT_VERSION]), u32(manifestBuf.length), manifestBuf,
      u32(KDF.N), u32(KDF.R), u32(KDF.P),
      Buffer.from([salt.length]), salt, Buffer.from([nonce.length]), nonce
    ]));

    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const meter = new PassThrough();
    let readBytes = 0;
    meter.on('data', (chunk: Buffer) => {
      readBytes += chunk.length;
      onProgress(Math.min(99, Math.round((readBytes / dbSizeBytes) * 100)));
    });
    try {
      await pipeline(
        fs.createReadStream(snapshot), meter, zlib.createGzip(), cipher,
        fs.createWriteStream(partPath, { flags: 'a' })
      );
    } catch (err) {
      mapWriteError(err);
    }
    fs.appendFileSync(partPath, cipher.getAuthTag());
    fs.renameSync(partPath, destPath);
    onProgress(100);
    return { sizeBytes: fs.statSync(destPath).size, sha256 };
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    if (err instanceof BackupError) throw err;
    mapWriteError(err);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Decrypt to a temp DB → validate (GCM tag, quick_check, sanity, SHA-256) →
 * close live DB → safety-copy → atomic rename → done. Any failure before the
 * swap leaves the live DB untouched; a swap failure rolls back automatically.
 * On SUCCESS the live handle stays closed — the caller relaunches the app.
 */
export async function restoreBackup(
  filePath: string,
  passphrase: string,
  onProgress: (percent: number) => void
): Promise<BackupManifest> {
  const header = readBackupHeader(filePath);
  const { manifest, kdf, salt, nonce, dataOffset, fileSize } = header;
  const key = await deriveKey(passphrase, salt, kdf);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonyan-restore-'));
  const tmpDb = path.join(tmpDir, 'restored.db');
  try {
    const fd = fs.openSync(filePath, 'r');
    const tag = Buffer.alloc(TAG_LEN);
    fs.readSync(fd, tag, 0, TAG_LEN, fileSize - TAG_LEN);
    fs.closeSync(fd);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const meter = new PassThrough();
    let written = 0;
    meter.on('data', (chunk: Buffer) => {
      written += chunk.length;
      if (manifest.dbSizeBytes) onProgress(Math.min(99, Math.round((written / manifest.dbSizeBytes) * 100)));
    });
    try {
      await pipeline(
        fs.createReadStream(filePath, { start: dataOffset, end: fileSize - TAG_LEN - 1 }),
        decipher, zlib.createGunzip(), meter, fs.createWriteStream(tmpDb)
      );
    } catch {
      // GCM auth failure surfaces at stream end; wrong passphrase and tampering
      // are indistinguishable (by design) and share one message (spec §10).
      throw new BackupError('AUTH', 'تعذر فك التشفير — كلمة المرور غير صحيحة أو الملف معدّل');
    }

    let tmp: Database.Database | null = null;
    try {
      tmp = new Database(tmpDb, { readonly: true, fileMustExist: true });
      const qc = tmp.pragma('quick_check') as Array<{ quick_check: string }>;
      if (qc[0]?.quick_check !== 'ok') {
        throw new BackupError('CORRUPT', 'النسخة تالفة — فشل فحص سلامة قاعدة البيانات');
      }
      const hasDocs = tmp.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get();
      const users = (tmp.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
      if (!hasDocs || users < 1) {
        throw new BackupError('CORRUPT', 'النسخة تالفة — فشل فحص سلامة قاعدة البيانات');
      }
    } finally {
      tmp?.close();
    }
    if ((await sha256File(tmpDb)) !== manifest.sha256) {
      throw new BackupError('CORRUPT', 'النسخة تالفة — بصمة الملف غير متطابقة');
    }

    const livePath = getDbPath();
    const backupsDir = path.join(path.dirname(livePath), 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const safety = path.join(backupsDir, `pre_restore_${Date.now()}.db`);
    closeDatabase();
    try {
      fs.copyFileSync(livePath, safety);
      fs.renameSync(tmpDb, livePath);
    } catch {
      try {
        fs.copyFileSync(safety, livePath);
        initDb();
      } catch { /* surfaced on next initDb/relaunch */ }
      throw new BackupError('IO', 'فشلت الاستعادة — تمت إعادة البيانات السابقة دون تغيير');
    }
    onProgress(100);
    return manifest;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the round-trip test — expect PASS**

Run: `bun run build:electron && electron scripts/test-backup-roundtrip.js`
Expected: `[PASS] backup round-trip: ...` and exit code 0.

- [ ] **Step 5: Report** — list changed files. No commit.

---

### Task 3: IPC layer — main.ts channels + preload + electron.d.ts

**Files:**
- Modify: `electron/main.ts` (import line :1; add handlers after the `db:import` handler at :413-420)
- Modify: `electron/preload.ts` (add `backupAPI` + `onBackupProgress` before the closing `});` at :112)
- Modify: `src/types/electron.d.ts` (add `BackupManifest` interface near :15; add `backupAPI` + `onBackupProgress` to `ElectronAPI` before its closing brace at :151)

**Interfaces:**
- Consumes (Task 2): `exportBackup`, `restoreBackup`, `readBackupHeader`, `compareVersions`, `BackupError`, `BACKUP_EXTENSION` from `electron/backup.ts`; Task 1's `getDbPath()`.
- Produces (used by Task 4's `BackupService`): channels `backup:chooseDestination`, `backup:export`, `backup:chooseBackupFile`, `backup:restore`, `backup:relaunchNow`, event `backup:progress` with payload `{ phase: 'export' | 'restore'; percent: number }`.

- [ ] **Step 1: main.ts — import `dialog` and the backup module**

Change line 1 to include `dialog`:

```ts
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell, IpcMainInvokeEvent } from 'electron';
```

Add to the database import block (the `from './database'` import that already lists `exportData, importData` near :89-99): add `getDbPath` to that list. Add a new import:

```ts
import { exportBackup, restoreBackup, readBackupHeader, compareVersions, BackupError, BACKUP_EXTENSION } from './backup';
```

- [ ] **Step 2: main.ts — register the five handlers**

Insert after the `db:import` handler (line ~420). Every handler follows the house pattern (`activeUser()` → role gate → work → `addAudit` → `{ success, error }`):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// External encrypted backup handlers (GM-only) — spec: docs/superpowers/specs/2026-08-22-external-backup-restore-design.md
// ─────────────────────────────────────────────────────────────────────────────

const backupRateLimitKey = (username: string): string => `backup-restore:${username.toLowerCase()}`;

ipcMain.handle('backup:chooseDestination', async () => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'اختيار مكان حفظ النسخة الاحتياطية',
      defaultPath: `bonyan-backup-${stamp}${BACKUP_EXTENSION}`,
      filters: [{ name: 'نسخة بنيان الاحتياطية', extensions: ['bonyan-backup'] }]
    });
    if (canceled || !filePath) return { success: true, canceled: true };
    const finalPath = filePath.endsWith(BACKUP_EXTENSION) ? filePath : filePath + BACKUP_EXTENSION;
    if (path.resolve(finalPath) === path.resolve(getDbPath())) {
      return { success: false, error: 'لا يمكن الحفظ مكان ملف قاعدة البيانات الحالية' };
    }
    return { success: true, filePath: finalPath };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('backup:export', async (_event: IpcMainInvokeEvent, filePath: string, passphrase: string) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    if (typeof passphrase !== 'string' || passphrase.length < 10) {
      return { success: false, error: 'كلمة مرور النسخة يجب ألا تقل عن 10 أحرف' };
    }
    if (typeof filePath !== 'string' || !filePath.endsWith(BACKUP_EXTENSION)) {
      return { success: false, error: 'مسار الحفظ غير صالح' };
    }
    const result = await exportBackup(
      filePath,
      passphrase,
      { appVersion: app.getVersion(), createdBy: user!.username },
      percent => mainWindow?.webContents.send('backup:progress', { phase: 'export', percent })
    );
    addAudit('تصدير نسخة احتياطية خارجية', undefined, `الوجهة: ${filePath} — البصمة: ${result.sha256}`, user!.username);
    return { success: true, filePath, sizeBytes: result.sizeBytes, sha256: result.sha256 };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('backup:chooseBackupFile', async () => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'اختيار نسخة احتياطية للاستعادة',
      properties: ['openFile'],
      filters: [{ name: 'نسخة بنيان الاحتياطية', extensions: ['bonyan-backup'] }]
    });
    if (canceled || filePaths.length === 0) return { success: true, canceled: true };
    const filePath = filePaths[0];
    const { manifest } = readBackupHeader(filePath);
    if (compareVersions(manifest.appVersion, app.getVersion()) > 0) {
      return { success: false, error: 'تم إنشاء هذه النسخة بإصدار أحدث من التطبيق — حدّث التطبيق قبل الاستعادة' };
    }
    return { success: true, filePath, manifest };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('backup:restore', async (_event: IpcMainInvokeEvent, filePath: string, passphrase: string) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const limitState = checkRateLimit(backupRateLimitKey(user!.username));
    if (limitState.locked) return { success: false, error: limitState.message };
    try {
      const manifest = await restoreBackup(
        filePath,
        passphrase,
        percent => mainWindow?.webContents.send('backup:progress', { phase: 'restore', percent })
      );
      clearRateLimit(backupRateLimitKey(user!.username));
      addAudit('استعادة نسخة احتياطية خارجية', undefined, `المصدر: ${filePath} — تاريخ النسخة: ${manifest.createdAt}`, user!.username);
      // The live DB handle is now closed and the file swapped — the renderer
      // shows the completion state and calls backup:relaunchNow.
      return { success: true };
    } catch (err: unknown) {
      if (err instanceof BackupError && err.code === 'AUTH') {
        const attempt = recordFailedCodeAttempt(backupRateLimitKey(user!.username));
        const message = attempt.locked
          ? 'تم تجاوز عدد المحاولات المسموح بها — تم تأمين التحقق مؤقتاً لمدة 15 دقيقة'
          : `${err.message} — المحاولات المتبقية قبل التأمين المؤقت: ${attempt.remaining}`;
        return { success: false, error: message };
      }
      throw err;
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('backup:relaunchNow', () => {
  const user = activeUser();
  if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
  app.relaunch();
  app.exit(0);
});
```

- [ ] **Step 3: preload.ts — expose `backupAPI` + `onBackupProgress`**

Insert before the closing `});` (after the `orgUnitAPI` block, line ~111). Keep the pure-passthrough rule; the event listener returns an unsubscribe function and never exposes `ipcRenderer` itself:

```ts
  ,

  backupAPI: {
    chooseDestination: () => ipcRenderer.invoke('backup:chooseDestination'),
    export: (filePath: string, passphrase: string) => ipcRenderer.invoke('backup:export', filePath, passphrase),
    chooseBackupFile: () => ipcRenderer.invoke('backup:chooseBackupFile'),
    restore: (filePath: string, passphrase: string) => ipcRenderer.invoke('backup:restore', filePath, passphrase),
    relaunchNow: () => ipcRenderer.invoke('backup:relaunchNow'),
  },
  onBackupProgress: (callback: (data: { phase: 'export' | 'restore'; percent: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { phase: 'export' | 'restore'; percent: number }) => callback(data);
    ipcRenderer.on('backup:progress', listener);
    return () => { ipcRenderer.removeListener('backup:progress', listener); };
  }
```

- [ ] **Step 4: electron.d.ts — the contract**

After the `OrgUnitInput` interface (~:26), add:

```ts
export interface BackupManifest {
  app: string;
  appVersion: string;
  createdAt: string;
  createdBy: string;
  dbSizeBytes: number;
  sha256: string;
  counts: { documents: number; archivedYears: number; folders: number; users: number };
}
```

Inside `ElectronAPI`, after the `orgUnitAPI` block (before the interface closes at ~:151), add:

```ts
  backupAPI: {
    chooseDestination: () => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
    export: (filePath: string, passphrase: string) => Promise<{ success: boolean; filePath?: string; sizeBytes?: number; sha256?: string; error?: string }>;
    chooseBackupFile: () => Promise<{ success: boolean; filePath?: string; manifest?: BackupManifest; canceled?: boolean; error?: string }>;
    restore: (filePath: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
    relaunchNow: () => Promise<{ success: boolean; error?: string }>;
  };
  onBackupProgress: (callback: (data: { phase: 'export' | 'restore'; percent: number }) => void) => () => void;
```

- [ ] **Step 5: Typecheck + build**

Run: `bunx tsc -p electron/tsconfig.json --noEmit && bun run build:prod`
Expected: clean.

- [ ] **Step 6: Report** — list changed files. No commit.

---

### Task 4: Angular BackupService + backup model

**Files:**
- Create: `src/app/models/backup.model.ts`
- Create: `src/app/services/backup.service.ts`

**Interfaces:**
- Consumes: `window.electronAPI.backupAPI` + `onBackupProgress` (Task 3), `unwrap` from `src/app/utils/ipc-result.util.ts`.
- Produces (used by Task 5's page): `BackupManifest` type (from `backup.model.ts` — renderer types live in `src/app/models/` per house convention; `electron.d.ts` keeps its own identical declaration for the Window contract, the same duplication pattern it already uses for `OrgUnit` etc.) and `BackupService` with `chooseDestination(): Promise<string | null>` (null = canceled), `export(filePath, passphrase): Promise<{ filePath: string; sizeBytes: number; sha256: string }>`, `chooseBackupFile(): Promise<{ filePath: string; manifest: BackupManifest } | null>`, `restore(filePath, passphrase): Promise<void>`, `relaunchNow(): Promise<void>`, `onProgress(cb): () => void`.

- [ ] **Step 1: Write the model**

`src/app/models/backup.model.ts`:

```ts
/** Manifest stored plaintext in a .bonyan-backup header — previewed before restore. */
export interface BackupManifest {
  app: string;
  appVersion: string;
  createdAt: string;
  createdBy: string;
  dbSizeBytes: number;
  sha256: string;
  counts: { documents: number; archivedYears: number; folders: number; users: number };
}
```

- [ ] **Step 2: Write the service**

```ts
import { Injectable } from '@angular/core';
import { BackupManifest } from '../models/backup.model';
import { unwrap } from '../utils/ipc-result.util';

// Thin typed wrapper over the GM-only external-backup IPC surface
// (electron/main.ts backup:* channels). All methods throw Errors via unwrap;
// components display them through ToastService.showError.
@Injectable({ providedIn: 'root' })
export class BackupService {
  private get api() {
    return window.electronAPI;
  }

  /** Returns the chosen destination path, or null when the user cancels. */
  async chooseDestination(): Promise<string | null> {
    const result = unwrap(await this.api.backupAPI.chooseDestination(), 'فشل اختيار مكان الحفظ');
    return result.canceled ? null : (result.filePath ?? null);
  }

  async export(filePath: string, passphrase: string): Promise<{ filePath: string; sizeBytes: number; sha256: string }> {
    const result = unwrap(await this.api.backupAPI.export(filePath, passphrase), 'فشل تصدير النسخة الاحتياطية');
    return { filePath: result.filePath!, sizeBytes: result.sizeBytes!, sha256: result.sha256! };
  }

  /** Returns the chosen file + parsed manifest, or null when canceled. */
  async chooseBackupFile(): Promise<{ filePath: string; manifest: BackupManifest } | null> {
    const result = unwrap(await this.api.backupAPI.chooseBackupFile(), 'فشل قراءة النسخة الاحتياطية');
    if (result.canceled) return null;
    if (!result.filePath || !result.manifest) throw new Error('الملف المحدد ليس نسخة احتياطية صالحة من هذا النظام');
    return { filePath: result.filePath, manifest: result.manifest };
  }

  /** On success the live DB is already swapped — show the completion UI, then relaunchNow(). */
  async restore(filePath: string, passphrase: string): Promise<void> {
    unwrap(await this.api.backupAPI.restore(filePath, passphrase), 'فشلت الاستعادة');
  }

  async relaunchNow(): Promise<void> {
    await this.api.backupAPI.relaunchNow();
  }

  /** Subscribe to export/restore progress; returns an unsubscribe function. */
  onProgress(callback: (data: { phase: 'export' | 'restore'; percent: number }) => void): () => void {
    return this.api.onBackupProgress(callback);
  }
}
```

- [ ] **Step 3: Build**

Run: `bun run build:prod`
Expected: clean.

- [ ] **Step 4: Report** — list changed files. No commit.

---

### Task 5: External-backup page + route + nav + permission key

**Files:**
- Create: `src/app/components/external-backup/external-backup.component.ts`
- Create: `src/app/components/external-backup/external-backup.component.html`
- Create: `src/app/components/external-backup/external-backup.component.scss`
- Modify: `src/app/app.routes.ts` (add child route after `'annual-closing/:year'` at :41)
- Modify: `src/app/components/app-shell/app-shell.component.html` (add nav link after the annual-closing link at :50-53)
- Modify: `src/app/models/user.model.ts` (`RolePermissions` :32-47 and the three literal maps :71-123)

**Interfaces:**
- Consumes: `BackupService` (Task 4); `AuthService.currentUser()`; `PasswordConfirmDialogComponent` (`data: { message: string }` → `afterClosed(): Observable<string | null>`, existing pattern from `audit-trail.component.ts:106-109`); `window.electronAPI.verifyPassword(username, password): Promise<boolean>` for GM re-auth (existing pattern from `audit-trail.component.ts:70`).
- Produces: route `/main/external-backup` (GM-only via `adminGuard`); nav item gated by the new `canExternalBackup` permission.

- [ ] **Step 1: Add the GM-only permission key**

In `src/app/models/user.model.ts`:
- Add `canExternalBackup: boolean;` to `RolePermissions` (after `canBrowseArchive`).
- Add `canExternalBackup: true` to `ALL_PERMISSIONS` (:71-86) and `canExternalBackup: false` to `HEAD_PERMISSIONS` (:91-106) and `EMPLOYEE_PERMISSIONS` (:108-123). If the file contains any other `RolePermissions` literal (e.g. a deputy map), add `false` there too — TypeScript rejects incomplete literals, so the build enforces completeness.

- [ ] **Step 2: The component class**

```ts
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BackupService } from '../../services/backup.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { PasswordConfirmDialogComponent } from '../dialogs/password-confirm-dialog/password-confirm-dialog.component';
import { BackupManifest } from '../../models/backup.model';

type Phase = 'idle' | 'running' | 'done';

@Component({
  selector: 'app-external-backup',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './external-backup.component.html',
  styleUrl: './external-backup.component.scss'
})
export class ExternalBackupComponent implements OnInit, OnDestroy {
  private backupService = inject(BackupService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);
  private unsubscribeProgress: (() => void) | null = null;

  unlocked = signal(false);           // GM re-authentication gate for this visit
  // Export state
  exportPath = signal('');
  exportPassword = signal('');
  exportPasswordConfirm = signal('');
  exportPhase = signal<Phase>('idle');
  exportPercent = signal(0);
  exportResult = signal<{ filePath: string; sizeBytes: number; sha256: string } | null>(null);
  // Restore state
  restoreFile = signal<{ filePath: string; manifest: BackupManifest } | null>(null);
  restorePassword = signal('');
  restoreAcknowledged = signal(false);
  restorePhase = signal<Phase>('idle');
  restorePercent = signal(0);
  restoreDone = signal(false);
  relaunchCountdown = signal(0);
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.unsubscribeProgress = this.backupService.onProgress(({ phase, percent }) => {
      if (phase === 'export') this.exportPercent.set(percent);
      else this.restorePercent.set(percent);
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeProgress?.();
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  /** GM account-password re-entry before either card unlocks (spec §6/§7). */
  async unlock(): Promise<void> {
    const username = this.auth.currentUser()?.username;
    if (!username) return;
    const ref = this.dialog.open(PasswordConfirmDialogComponent, {
      width: '420px', maxWidth: '95vw',
      data: { message: 'أدخل كلمة مرور حسابك للمتابعة — هذه العملية حساسة وتخص المدير العام فقط' }
    });
    const password: string | null = await new Promise(resolve => ref.afterClosed().subscribe(resolve));
    if (!password) return;
    const ok = await window.electronAPI.verifyPassword(username, password);
    if (!ok) {
      this.toast.show('كلمة المرور غير صحيحة', 'error');
      return;
    }
    this.unlocked.set(true);
  }

  async chooseDestination(): Promise<void> {
    try {
      const p = await this.backupService.chooseDestination();
      if (p) this.exportPath.set(p);
    } catch (err) { this.toast.showError(err, 'فشل اختيار مكان الحفظ'); }
  }

  exportReady(): boolean {
    return this.exportPhase() !== 'running' && !!this.exportPath()
      && this.exportPassword().length >= 10 && this.exportPassword() === this.exportPasswordConfirm();
  }

  async startExport(): Promise<void> {
    if (!this.exportReady()) return;
    this.exportPhase.set('running');
    this.exportPercent.set(0);
    this.exportResult.set(null);
    const passphrase = this.exportPassword();
    this.exportPassword.set('');
    this.exportPasswordConfirm.set('');
    try {
      const result = await this.backupService.export(this.exportPath(), passphrase);
      this.exportResult.set(result);
      this.exportPhase.set('done');
      this.toast.show('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } catch (err) {
      this.exportPhase.set('idle');
      this.toast.showError(err, 'فشل تصدير النسخة الاحتياطية');
    }
  }

  async chooseRestoreFile(): Promise<void> {
    try {
      const picked = await this.backupService.chooseBackupFile();
      if (picked) this.restoreFile.set(picked);
    } catch (err) { this.toast.showError(err, 'فشل قراءة النسخة الاحتياطية'); }
  }

  restoreReady(): boolean {
    return this.restorePhase() !== 'running' && !!this.restoreFile()
      && this.restorePassword().length >= 1 && this.restoreAcknowledged();
  }

  async startRestore(): Promise<void> {
    const file = this.restoreFile();
    if (!this.restoreReady() || !file) return;
    this.restorePhase.set('running');
    this.restorePercent.set(0);
    const passphrase = this.restorePassword();
    this.restorePassword.set('');
    try {
      await this.backupService.restore(file.filePath, passphrase);
      this.restorePhase.set('done');
      this.restoreDone.set(true);
      this.startRelaunchCountdown();
    } catch (err) {
      this.restorePhase.set('idle');
      this.toast.showError(err, 'فشلت الاستعادة');
    }
  }

  private startRelaunchCountdown(): void {
    this.relaunchCountdown.set(10);
    this.countdownTimer = setInterval(() => {
      const left = this.relaunchCountdown() - 1;
      this.relaunchCountdown.set(left);
      if (left <= 0) void this.relaunchNow();
    }, 1000);
  }

  async relaunchNow(): Promise<void> {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    await this.backupService.relaunchNow();
  }

  formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }
}
```

- [ ] **Step 3: The component template**

Match the app's card/Tailwind idiom (see `security-center.component.html` for the pattern). Structure:

```html
<div dir="rtl" class="p-6 max-w-4xl mx-auto">
  <h2 class="text-xl font-bold text-primary mb-1">النسخ الاحتياطي الخارجي</h2>
  <p class="text-text-light text-sm mb-6">تصدير نسخة مشفرة كاملة من الأرشيف إلى قرص خارجي، واستعادتها عند الحاجة.</p>

  @if (!unlocked()) {
    <div class="border border-border rounded-xl p-8 text-center bg-bg">
      <mat-icon class="text-4xl text-primary mb-3">lock</mat-icon>
      <p class="mb-4">هذه العملية حساسة وتتطلب تأكيد هوية المدير العام.</p>
      <button mat-raised-button color="primary" (click)="unlock()">تأكيد الهوية</button>
    </div>
  } @else {
    <!-- ═══ Export card ═══ -->
    <section class="border border-border rounded-xl p-5 mb-6">
      <h3 class="flex items-center gap-2 font-bold text-primary mb-3"><mat-icon>usb</mat-icon> تصدير نسخة احتياطية</h3>
      <div class="flex items-center gap-3 mb-4">
        <button mat-stroked-button (click)="chooseDestination()" [disabled]="exportPhase() === 'running'">اختيار مكان الحفظ</button>
        <span class="text-sm text-text-light break-all">{{ exportPath() || 'لم يتم اختيار وجهة بعد' }}</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <label class="block text-sm">كلمة مرور النسخة (10 أحرف على الأقل)
          <input type="password" class="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-bg" [ngModel]="exportPassword()" (ngModelChange)="exportPassword.set($event)" autocomplete="new-password">
        </label>
        <label class="block text-sm">تأكيد كلمة المرور
          <input type="password" class="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-bg" [ngModel]="exportPasswordConfirm()" (ngModelChange)="exportPasswordConfirm.set($event)" autocomplete="new-password">
        </label>
      </div>
      @if (exportPassword() && exportPassword() !== exportPasswordConfirm()) {
        <p class="text-danger text-xs mb-2">كلمتا المرور غير متطابقتين</p>
      }
      <p class="text-text-light text-xs mb-4">احتفظ بكلمة المرور في مكان آمن — لا يمكن استعادة النسخة بدونها.</p>
      @if (exportPhase() === 'running') {
        <mat-progress-bar mode="determinate" [value]="exportPercent()"></mat-progress-bar>
        <p class="text-xs text-text-light mt-1">جاري التصدير… {{ exportPercent() }}%</p>
      }
      @if (exportResult(); as r) {
        <div class="border border-success rounded-lg p-3 mb-3 text-sm">
          <p class="font-bold text-success mb-1">اكتمل التصدير بنجاح</p>
          <p>الملف: <span dir="ltr">{{ r.filePath }}</span></p>
          <p>الحجم: {{ formatSize(r.sizeBytes) }} — البصمة: <span dir="ltr" class="text-xs">{{ r.sha256 }}</span></p>
        </div>
      }
      <button mat-raised-button color="primary" (click)="startExport()" [disabled]="!exportReady()">بدء التصدير</button>
    </section>

    <!-- ═══ Restore card ═══ -->
    <section class="border border-border rounded-xl p-5">
      <h3 class="flex items-center gap-2 font-bold text-primary mb-3"><mat-icon>restore</mat-icon> استعادة نسخة احتياطية</h3>
      @if (restoreDone()) {
        <div class="border border-success rounded-lg p-6 text-center">
          <mat-icon class="text-4xl text-success mb-2">check_circle</mat-icon>
          <p class="font-bold mb-2">اكتملت الاستعادة بنجاح</p>
          <p class="text-sm text-text-light mb-4">سيتم إعادة تشغيل التطبيق خلال {{ relaunchCountdown() }} ثانية — سجّل الدخول ببيانات المستخدمين المخزنة في النسخة.</p>
          <button mat-raised-button color="primary" (click)="relaunchNow()">إعادة تشغيل التطبيق الآن</button>
        </div>
      } @else {
        <div class="flex items-center gap-3 mb-4">
          <button mat-stroked-button (click)="chooseRestoreFile()" [disabled]="restorePhase() === 'running'">اختيار ملف النسخة</button>
          <span class="text-sm text-text-light break-all">{{ restoreFile()?.filePath || 'لم يتم اختيار ملف بعد' }}</span>
        </div>
        @if (restoreFile(); as f) {
          <div class="border border-border rounded-lg p-3 mb-4 text-sm grid grid-cols-2 gap-2">
            <span>تاريخ الإنشاء: {{ f.manifest.createdAt | date:'yyyy-MM-dd HH:mm' }}</span>
            <span>أنشأها: {{ f.manifest.createdBy }}</span>
            <span>إصدار التطبيق: {{ f.manifest.appVersion }}</span>
            <span>الحجم: {{ formatSize(f.manifest.dbSizeBytes) }}</span>
            <span>الوثائق: {{ f.manifest.counts.documents }}</span>
            <span>السنوات المغلقة: {{ f.manifest.counts.archivedYears }}</span>
          </div>
          <div class="border border-danger rounded-lg p-3 mb-4 text-sm text-danger">
            سيتم استبدال جميع البيانات الحالية بمحتوى النسخة — سيتم أولاً حفظ نسخة أمان من البيانات الحالية تلقائياً.
            <label class="flex items-center gap-2 mt-2">
              <input type="checkbox" [ngModel]="restoreAcknowledged()" (ngModelChange)="restoreAcknowledged.set($event)">
              أفهم أن البيانات الحالية ستُستبدل
            </label>
          </div>
          <label class="block text-sm mb-4">كلمة مرور النسخة
            <input type="password" class="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-bg" [ngModel]="restorePassword()" (ngModelChange)="restorePassword.set($event)">
          </label>
          @if (restorePhase() === 'running') {
            <mat-progress-bar mode="determinate" [value]="restorePercent()"></mat-progress-bar>
            <p class="text-xs text-text-light mt-1">جاري الاستعادة… {{ restorePercent() }}%</p>
          }
          <button mat-raised-button color="warn" (click)="startRestore()" [disabled]="!restoreReady()">بدء الاستعادة</button>
        }
      }
    </section>
  }
</div>
```

SCSS file: minimal (the page rides on Tailwind + Material like its siblings) — a single comment line is fine: `/* External-backup page — layout via Tailwind classes in the template. */`

- [ ] **Step 4: Route + nav**

`src/app/app.routes.ts` — import the component (with the other component imports at :1-16):

```ts
import { ExternalBackupComponent } from './components/external-backup/external-backup.component';
```

and add after the `'annual-closing/:year'` route (:41):

```ts
{ path: 'external-backup', component: ExternalBackupComponent, canActivate: [adminGuard] },
```

`src/app/components/app-shell/app-shell.component.html` — after the annual-closing `<a>` block (:50-53), add:

```html
          <a *appHasPermission="'canExternalBackup'" routerLink="/main/external-backup" routerLinkActive="active" class="nav-link">
            <mat-icon>usb</mat-icon>
            <span>النسخ الاحتياطي الخارجي</span>
          </a>
```

(Match the exact inner markup of the neighboring links — icon name + span text — by reading lines 46-53 first.)

- [ ] **Step 5: Build**

Run: `bun run build:prod`
Expected: clean.

- [ ] **Step 6: Report** — list changed files. No commit.

---

### Task 6: Full verification + version bump

**Files:**
- Modify: `package.json` (:3 — `"version": "1.3.0"` → `"1.4.0"`; release convention: version bumps land in package.json, tagging stays the user's action)

- [ ] **Step 1: Build**

Run: `bun run build:prod` — Expected: clean.

- [ ] **Step 2: Smoke tests**

Run: `bun run test:login` — Expected: admin login OK, wrong password rejected.
Run: `electron scripts/test-backup-roundtrip.js` — Expected: `[PASS] backup round-trip: ...`.

- [ ] **Step 3: Manual verification (`bun run start`)**

- Nav shows «النسخ الاحتياطي الخارجي» for GM only; route redirects non-GM away.
- Identity gate → export to a USB drive → success panel shows path/size/fingerprint; file present on the drive.
- Unplug drive mid-export (or pick an unwritable path) → Arabic error, no `.part` file left behind.
- Restore from the exported file: manifest preview correct; wrong passphrase → error with remaining-attempts count; correct passphrase → completion card → relaunch → login with backup credentials → spot-check a document and an archived year.
- Regression: legacy dashboard JSON export/import still works; annual closing still works.
- Restore rollback (spec §11): the swap-failure path requires fault injection that is not scriptable from the outside — it is verified by code review of `restoreBackup`'s swap `catch` (safety copy back + `initDb()`), not by an automated test. Note this honestly in the task report instead of claiming it was exercised.

- [ ] **Step 4: Report** — summarize everything changed; remind the user that tagging `v1.4.0` (their action) fires the release workflow.
