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
      .on('data', (d: string | Buffer) => hash.update(d))
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
      u32(KDF.N), u32(KDF.r), u32(KDF.p),
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
    // Best-effort: a leftover .part file must not mask the real error.
    try { fs.rmSync(partPath, { force: true }); } catch { /* ignore */ }
    if (err instanceof BackupError) throw err;
    // Only genuine fs failures get the Arabic IO message; anything else
    // (scrypt, snapshot, …) propagates unchanged.
    if ((err as NodeJS.ErrnoException)?.code) return mapWriteError(err);
    throw err;
  } finally {
    // Windows may briefly hold file handles after stream teardown; retry and
    // never let temp cleanup mask the operation result.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* ignore */ }
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

  // Stage the decrypted DB next to the live one so the final renameSync stays
  // on the same volume (os.tmpdir() may be a different drive → EXDEV on Windows).
  const livePath = getDbPath();
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(livePath), '.restore-'));
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
    // Windows may briefly hold file handles after stream teardown; retry and
    // never let temp cleanup mask the operation result.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* ignore */ }
  }
}
