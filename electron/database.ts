import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { app } from 'electron';

type DocumentType = 'صادر' | 'وارد' | 'مراسلات';

let db: Database.Database | null = null;

export function initDb(): void {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'archive.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      folder_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      sender TEXT,
      receiver TEXT,
      author TEXT,
      address TEXT,
      target TEXT,
      content TEXT,
      input_method TEXT,
      date TEXT NOT NULL,
      body TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'قيد الاعتماد',
      signature_base64 TEXT,
      attachments_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS counters (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      doc_ref TEXT,
      details TEXT,
      username TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
    CREATE INDEX IF NOT EXISTS idx_documents_ref ON documents(ref_number);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  `);

  seedFolders();
  seedAdmin();
  migrateDocumentsColumns();
}

function migrateDocumentsColumns(): void {
  if (!db) return;
  const columns = ['author', 'address', 'target', 'content', 'input_method'];
  for (const col of columns) {
    try {
      db.exec(`ALTER TABLE documents ADD COLUMN ${col} TEXT`);
    } catch {
      // column probably already exists
    }
  }
}

function seedFolders(): void {
  if (!db) return;
  const count = db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number };
  if (count.c > 0) return;

  const foldersPath = path.join(__dirname, '../bonyan-archive-system/browser/assets/data/folders.json');
  if (!fs.existsSync(foldersPath)) {
    console.error('folders.json not found at', foldersPath);
    return;
  }

  const folders = JSON.parse(fs.readFileSync(foldersPath, 'utf-8')) as Array<{ id: number; name: string; group_name: string }>;
  const insert = db.prepare('INSERT INTO folders (id, name, group_name) VALUES (?, ?, ?)');
  const insertMany = db.transaction((items: typeof folders) => {
    for (const item of items) {
      insert.run(item.id, item.name, item.group_name);
    }
  });
  insertMany(folders);
}

function seedAdmin(): void {
  if (!db) return;
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (count.c > 0) return;

  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
}

export function query(sql: string, params?: unknown[]): unknown[] {
  if (!db) throw new Error('Database not initialized');
  return db.prepare(sql).all(...(params ?? []));
}

export function run(sql: string, params?: unknown[]): { lastInsertRowid: number | bigint; changes: number } {
  if (!db) throw new Error('Database not initialized');
  const result = db.prepare(sql).run(...(params ?? []));
  return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
}

const TYPE_PREFIX: Record<DocumentType, string> = {
  صادر: 'S',
  وارد: 'W',
  مراسلات: 'M',
};

export function getNextRef(type: DocumentType, folderId: number): string {
  if (!db) throw new Error('Database not initialized');
  const year = new Date().getFullYear();
  const key = `${type}_${folderId}_${year}`;

  db.prepare('INSERT OR IGNORE INTO counters (key, value) VALUES (?, 0)').run(key);
  db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);

  const row = db.prepare('SELECT value FROM counters WHERE key = ?').get(key) as { value: number };
  const prefix = TYPE_PREFIX[type] ?? 'X';
  return `${prefix}-${String(folderId).padStart(3, '0')}-${year}-${String(row.value).padStart(4, '0')}`;
}

export function addAudit(action: string, docRef?: string, details?: string, username?: string): void {
  if (!db) return;
  db.prepare('INSERT INTO audit_log (action, doc_ref, details, username) VALUES (?, ?, ?, ?)')
    .run(action, docRef ?? null, details ?? null, username ?? null);
}

export function getStats(): Record<string, number> {
  if (!db) throw new Error('Database not initialized');
  const total = db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number };
  const sadir = db.prepare("SELECT COUNT(*) as c FROM documents WHERE type = 'صادر'").get() as { c: number };
  const ward = db.prepare("SELECT COUNT(*) as c FROM documents WHERE type = 'وارد'").get() as { c: number };
  const maraslat = db.prepare("SELECT COUNT(*) as c FROM documents WHERE type = 'مراسلات'").get() as { c: number };

  return {
    total: total.c,
    صادر: sadir.c,
    وارد: ward.c,
    مراسلات: maraslat.c,
  };
}

export function exportData(): string {
  if (!db) throw new Error('Database not initialized');
  const folders = query('SELECT * FROM folders');
  const documents = query('SELECT * FROM documents');
  const counters = query('SELECT * FROM counters');
  const audit_log = query('SELECT * FROM audit_log');
  const users = query('SELECT * FROM users');

  return JSON.stringify({ folders, documents, counters, audit_log, users }, null, 2);
}

export function importData(jsonData: string, mode: 'merge' | 'replace'): { success: boolean; message: string } {
  if (!db) throw new Error('Database not initialized');
  try {
    const data = JSON.parse(jsonData) as {
      folders?: Array<{ id: number; name: string; group_name: string }>;
      documents?: Array<Record<string, unknown>>;
      counters?: Array<{ key: string; value: number }>;
      audit_log?: Array<Record<string, unknown>>;
      users?: Array<Record<string, unknown>>;
    };

    if (mode === 'replace') {
      db.exec('DELETE FROM audit_log; DELETE FROM documents; DELETE FROM counters; DELETE FROM folders; DELETE FROM users;');
    }

    const insertFolder = db.prepare('INSERT OR REPLACE INTO folders (id, name, group_name) VALUES (?, ?, ?)');
    const insertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents (
        id, ref_number, type, folder_id, subject, sender, receiver, author, address, target, content, input_method,
        date, body, notes,
        status, signature_base64, attachments_json, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCounter = db.prepare('INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)');
    const insertAudit = db.prepare('INSERT OR REPLACE INTO audit_log (id, action, doc_ref, details, username, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
    const insertUser = db.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)');

    const tx = db.transaction(() => {
      if (data.folders) {
        for (const item of data.folders) {
          insertFolder.run(item.id, item.name, item.group_name);
        }
      }
      if (data.documents) {
        for (const item of data.documents) {
          insertDoc.run(
            (item.id as number | undefined) ?? null,
            item.ref_number,
            item.type,
            item.folder_id,
            item.subject,
            item.sender ?? null,
            item.receiver ?? null,
            item.author ?? null,
            item.address ?? null,
            item.target ?? null,
            item.content ?? null,
            item.input_method ?? null,
            item.date,
            item.body ?? null,
            item.notes ?? null,
            item.status ?? 'قيد الاعتماد',
            item.signature_base64 ?? null,
            item.attachments_json ?? '[]',
            item.created_at ?? new Date().toISOString(),
            item.updated_at ?? new Date().toISOString(),
            item.created_by ?? null
          );
        }
      }
      if (data.counters) {
        for (const item of data.counters) {
          insertCounter.run(item.key, item.value);
        }
      }
      if (data.audit_log) {
        for (const item of data.audit_log) {
          insertAudit.run(
            (item.id as number | undefined) ?? null,
            item.action,
            item.doc_ref ?? null,
            item.details ?? null,
            item.username ?? null,
            item.timestamp ?? new Date().toISOString()
          );
        }
      }
      if (data.users) {
        for (const item of data.users) {
          insertUser.run(
            (item.id as number | undefined) ?? null,
            item.username,
            item.password_hash,
            item.role,
            item.created_at ?? new Date().toISOString()
          );
        }
      }
    });

    tx();
    return { success: true, message: 'تم استيراد البيانات بنجاح' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message };
  }
}
