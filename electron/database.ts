import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { app } from 'electron';
import crypto from 'crypto';

/*
  Fallback in-memory store used only if better-sqlite3 fails to load.
  This is a temporary workaround so the login screen does not hang.
*/
interface InMemoryUser {
  id: number;
  username: string;
  password_hash: string;
  full_name: string | null;
  role: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface InMemorySession {
  id: number;
  user_id: number;
  username: string;
  action: 'login' | 'logout';
  ip_address: string;
  device_info: string;
  timestamp: number;
}

interface InMemoryFolderPermission {
  id: number;
  user_id: number;
  folder_id: number;
  can_view: number;
  can_create: number;
  can_edit: number;
  can_delete: number;
}

interface InMemoryDocumentType {
  id: number;
  name: string;
  label: string;
  color: string;
  icon: string;
  prefix: string;
  is_active: number;
  is_system: number;
  created_at: number;
}

interface InMemoryFolder {
  id: number;
  name: string;
  group_name: string;
  is_system: number;
  is_active: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

interface InMemoryDocument {
  id?: number;
  ref_number: string;
  type_id: number;
  folder_id: number;
  confidentiality: string;
  subject: string;
  sender?: string;
  receiver?: string;
  author?: string;
  address?: string;
  target?: string;
  content?: string;
  input_method?: string;
  date: string;
  body?: string;
  notes?: string;
  status: string;
  signature_base64?: string;
  attachments_json: string;
  created_at?: number;
  updated_at?: number;
  created_by?: string;
}

interface InMemoryVerificationCode {
  id: number;
  code: string;
  code_hash: string;
  generated_at: number;
  expires_at: number;
  is_active: number;
  generated_by: number;
}

interface InMemoryAccessLog {
  id: number;
  document_id: number;
  user_id: number;
  user_username: string;
  access_type: string;
  confidentiality_level: string;
  verification_method?: string | null;
  timestamp: number;
}

interface InMemoryResetRequest {
  id: number;
  user_id: number;
  username: string;
  request_date: number;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: number;
  approved_at?: number;
  new_password_hash?: string;
}

interface InMemoryArchivedYear {
  year: number;
  archived_at: number;
  archived_by?: number;
  document_count?: number;
  backup_path?: string;
  notes?: string;
}

interface InMemoryStore {
  users: InMemoryUser[];
  folders: InMemoryFolder[];
  documents: InMemoryDocument[];
  document_types: InMemoryDocumentType[];
  counters: Record<string, number>;
  audit_log: unknown[];
  user_sessions: InMemorySession[];
  user_folder_permissions: InMemoryFolderPermission[];
  system_verification_codes: InMemoryVerificationCode[];
  document_access_log: InMemoryAccessLog[];
  password_reset_requests: InMemoryResetRequest[];
  archived_years: InMemoryArchivedYear[];
}

const memoryStore: InMemoryStore = {
  users: [{
    id: 1,
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
    full_name: 'المدير الافتراضي',
    role: 'admin',
    is_active: 1,
    created_at: Date.now(),
    updated_at: Date.now()
  }],
  folders: [],
  documents: [],
  document_types: [
    { id: 1, name: 'صادر', label: 'صادر', color: '#059669', icon: '📤', prefix: 'S', is_active: 1, is_system: 1, created_at: Date.now() },
    { id: 2, name: 'وارد', label: 'وارد', color: '#2563eb', icon: '📥', prefix: 'W', is_active: 1, is_system: 1, created_at: Date.now() },
    { id: 3, name: 'مراسلات', label: 'مراسلات داخلية', color: '#d97706', icon: '✉️', prefix: 'M', is_active: 1, is_system: 1, created_at: Date.now() }
  ],
  counters: {},
  audit_log: [],
  user_sessions: [],
  user_folder_permissions: [],
  system_verification_codes: [],
  document_access_log: [],
  password_reset_requests: [],
  archived_years: []
};

let useMemoryFallback = false;
let db: Database.Database | null = null;
let initError: string | null = null;

export function initDb(): { success: boolean; error?: string } {
  console.log('[Database] initDb() called');

  if (db) {
    console.log('[Database] Database already initialized');
    return { success: true };
  }

  if (useMemoryFallback) {
    console.warn('[Database] Running in memory fallback mode');
    return { success: true, error: 'Fallback mode: using in-memory store (no persistence)' };
  }

  try {
    const userData = app.getPath('userData');
    const dbPath = path.join(userData, 'archive.db');
    console.log('[Database] Opening SQLite DB at:', dbPath);

    db = new Database(dbPath);
    console.log('[Database] SQLite connection established');

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'editor', 'viewer')),
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('login', 'logout')),
        ip_address TEXT DEFAULT 'localhost',
        device_info TEXT,
        timestamp INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_time ON user_sessions(timestamp);

      CREATE TABLE IF NOT EXISTS user_folder_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        can_view INTEGER DEFAULT 1,
        can_create INTEGER DEFAULT 0,
        can_edit INTEGER DEFAULT 0,
        can_delete INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
        UNIQUE(user_id, folder_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ufp_user ON user_folder_permissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_ufp_folder ON user_folder_permissions(folder_id);

      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        is_system INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS document_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        label TEXT NOT NULL,
        color TEXT DEFAULT '#2563eb',
        icon TEXT DEFAULT '📄',
        prefix TEXT NOT NULL UNIQUE,
        is_active INTEGER DEFAULT 1,
        is_system INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        type_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        confidentiality TEXT DEFAULT 'عادي' CHECK(confidentiality IN ('عادي', 'سري', 'سري للغاية')),
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
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        created_by TEXT,
        FOREIGN KEY (type_id) REFERENCES document_types(id),
        FOREIGN KEY (folder_id) REFERENCES folders(id)
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
        timestamp INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS system_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        generated_at INTEGER DEFAULT (strftime('%s','now')),
        expires_at INTEGER,
        is_active INTEGER DEFAULT 1,
        generated_by INTEGER,
        FOREIGN KEY (generated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS document_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_username TEXT NOT NULL,
        access_type TEXT NOT NULL CHECK(access_type IN ('view', 'edit')),
        confidentiality_level TEXT NOT NULL,
        verification_method TEXT,
        timestamp INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        request_date INTEGER DEFAULT (strftime('%s','now')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        approved_by INTEGER,
        approved_at INTEGER,
        new_password_hash TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS archived_years (
        year INTEGER PRIMARY KEY,
        archived_at INTEGER DEFAULT (strftime('%s','now')),
        archived_by INTEGER,
        document_count INTEGER,
        backup_path TEXT,
        notes TEXT,
        FOREIGN KEY (archived_by) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
      CREATE INDEX IF NOT EXISTS idx_documents_ref ON documents(ref_number);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_access_log_document ON document_access_log(document_id);
      CREATE INDEX IF NOT EXISTS idx_access_log_user ON document_access_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_reset_status ON password_reset_requests(status);
    `);
    console.log('[Database] Schema created/verified');

    seedFolders();
    migrateUsersTable();
    migrateRoles();
    seedAdmin();
    migrateDocumentsColumns();
    seedDocumentTypes();
    migrateDocumentTypeId();
    migrateFolderSystemFlags();
    migrateDocumentConfidentiality();
    createPostMigrationIndexes();

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    console.error('[Database] Failed to initialize better-sqlite3:', message);
    initError = message;

    console.warn('[Database] Activating in-memory fallback store');
    useMemoryFallback = true;
    return { success: true, error: `Database fallback active: ${message}` };
  }
}

export function getInitError(): string | null {
  return initError;
}

function migrateDocumentsColumns(): void {
  if (!db || useMemoryFallback) return;
  const columns = ['author', 'address', 'target', 'content', 'input_method', 'status', 'created_by'];
  for (const col of columns) {
    try {
      db.exec(`ALTER TABLE documents ADD COLUMN ${col} TEXT`);
    } catch {
      // column probably already exists
    }
  }
}

function seedDocumentTypes(): void {
  if (!db || useMemoryFallback) return;
  const count = db.prepare('SELECT COUNT(*) as c FROM document_types').get() as { c: number };
  if (count.c > 0) return;
  const insert = db.prepare(`
    INSERT INTO document_types (name, label, color, icon, prefix, is_system) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    insert.run('صادر', 'صادر', '#059669', '📤', 'S', 1);
    insert.run('وارد', 'وارد', '#2563eb', '📥', 'W', 1);
    insert.run('مراسلات', 'مراسلات داخلية', '#d97706', '✉️', 'M', 1);
  });
  tx();
  console.log('[Database] Seeded system document types');
}

function migrateDocumentTypeId(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  const hasTypeId = columns.some(c => c.name === 'type_id');
  const hasType = columns.some(c => c.name === 'type');

  if (!hasTypeId) {
    try {
      db.exec(`ALTER TABLE documents ADD COLUMN type_id INTEGER NOT NULL DEFAULT 1`);
    } catch {
      return;
    }
    if (hasType) {
      const typeMap: Record<string, number> = { 'صادر': 1, 'وارد': 2, 'مراسلات': 3 };
      const update = db.prepare('UPDATE documents SET type_id = ? WHERE type = ?');
      const tx = db.transaction(() => {
        for (const [type, id] of Object.entries(typeMap)) {
          update.run(id, type);
        }
      });
      tx();
    }
    console.log('[Database] Migrated documents.type to type_id');
  }

  // Drop legacy type column to prevent NOT NULL constraint failures on inserts
  if (hasType) {
    try {
      db.exec('ALTER TABLE documents DROP COLUMN type');
      console.log('[Database] Dropped legacy documents.type column');
    } catch (err) {
      console.warn('[Database] Could not drop legacy type column, recreating table:', err instanceof Error ? err.message : err);
      recreateDocumentsTableWithoutType();
    }
  }
}

function recreateDocumentsTableWithoutType(): void {
  if (!db || useMemoryFallback) return;
  try {
    db.exec(`
      CREATE TABLE documents_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        type_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        confidentiality TEXT DEFAULT 'عادي' CHECK(confidentiality IN ('عادي', 'سري', 'سري للغاية')),
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
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        created_by TEXT,
        FOREIGN KEY (type_id) REFERENCES document_types(id),
        FOREIGN KEY (folder_id) REFERENCES folders(id)
      );

      INSERT INTO documents_new
        (id, ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, author, address, target, content, input_method,
         date, body, notes, status, signature_base64, attachments_json, created_at, updated_at, created_by)
      SELECT
        id, ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, author, address, target, content, input_method,
        date, body, notes, status, signature_base64, attachments_json, created_at, updated_at, created_by
      FROM documents;

      DROP TABLE documents;
      ALTER TABLE documents_new RENAME TO documents;
    `);
    console.log('[Database] Recreated documents table without legacy type column');
  } catch (err) {
    console.error('[Database] Failed to recreate documents table:', err instanceof Error ? err.message : err);
  }
}

function migrateFolderSystemFlags(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
  const names = new Set(columns.map(c => c.name));
  for (const col of ['is_system', 'is_active', 'created_by', 'created_at', 'updated_at']) {
    if (!names.has(col)) {
      try {
        db!.exec(`ALTER TABLE folders ADD COLUMN ${col} INTEGER DEFAULT 0`);
      } catch {
        // ignore
      }
    }
  }
  try {
    db.exec("UPDATE folders SET is_system = 1, is_active = 1 WHERE is_system = 0 AND id <= 177");
    db.exec("UPDATE folders SET is_active = 1 WHERE is_active IS NULL OR is_active = 0");
  } catch {
    // ignore
  }
}

function migrateDocumentConfidentiality(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'confidentiality')) {
    try {
      db.exec("ALTER TABLE documents ADD COLUMN confidentiality TEXT DEFAULT 'عادي' CHECK(confidentiality IN ('عادي', 'سري', 'سري للغاية'))");
    } catch (err) {
      console.warn('[Database] Failed to add confidentiality column:', err instanceof Error ? err.message : err);
    }
  }
}

function createPostMigrationIndexes(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  const names = new Set(columns.map(c => c.name));
  try {
    if (names.has('type_id')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type_id)');
    }
    if (names.has('confidentiality')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_documents_confidentiality ON documents(confidentiality)');
    }
  } catch (err) {
    console.warn('[Database] Failed to create post-migration indexes:', err instanceof Error ? err.message : err);
  }
}

function seedFolders(): void {
  if (!db || useMemoryFallback) return;
  const count = db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number };
  if (count.c > 0) {
    console.log('[Database] Folders already seeded');
    return;
  }

  const foldersPath = path.join(__dirname, '../bonyan-archive-system/browser/assets/data/folders.json');
  console.log('[Database] Reading folders seed from:', foldersPath);
  if (!fs.existsSync(foldersPath)) {
    console.error('[Database] folders.json not found at', foldersPath);
    return;
  }

  try {
    const folders = JSON.parse(fs.readFileSync(foldersPath, 'utf-8')) as Array<{ id: number; name: string; group_name: string }>;
    const insert = db.prepare('INSERT INTO folders (id, name, group_name, is_system, is_active) VALUES (?, ?, ?, 1, 1)');
    const insertMany = db.transaction((items: typeof folders) => {
      for (const item of items) {
        insert.run(item.id, item.name, item.group_name);
      }
    });
    insertMany(folders);
    console.log('[Database] Seeded', folders.length, 'folders');
  } catch (err: unknown) {
    console.error('[Database] Failed to seed folders:', err instanceof Error ? err.message : err);
  }
}

function migrateUsersTable(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const names = new Set(columns.map(c => c.name));

  const addColumn = (name: string, def: string) => {
    if (!names.has(name)) {
      try {
        db!.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
        console.log('[Database] Added users column:', name);
      } catch (err) {
        console.error('[Database] Failed to add users column', name, err);
      }
    }
  };

  addColumn('full_name', 'TEXT');
  addColumn('is_active', 'INTEGER DEFAULT 1');
  addColumn('updated_at', 'INTEGER');
  try {
    db!.exec("UPDATE users SET updated_at = COALESCE(updated_at, created_at, strftime('%s','now'))");
  } catch {
    // ignore
  }
}

function migrateRoles(): void {
  if (!db || useMemoryFallback) return;
  try {
    const result = db.prepare("UPDATE users SET role = 'viewer' WHERE role = 'user'").run();
    if (result.changes > 0) {
      console.log('[Database] Migrated', result.changes, "legacy 'user' roles to 'viewer'");
    }
  } catch (err) {
    console.error('[Database] Failed to migrate roles:', err);
  }
}

function seedAdmin(): void {
  if (useMemoryFallback) {
    console.log('[Database] Fallback store already contains admin/admin123');
    return;
  }
  if (!db) return;

  const hash = bcrypt.hashSync('admin123', 10);

  const existing = db.prepare('SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?').get('admin') as
    | { id: number; username: string; password_hash: string; full_name: string | null; role: string; is_active: number }
    | undefined;

  if (!existing) {
    console.log('[Database] Seeding default admin user (admin / admin123)');
    db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?)"
    ).run('admin', hash, 'المدير الافتراضي', 'admin', 1);
    console.log('[Database] Default admin user created');
    return;
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (!bcrypt.compareSync('admin123', existing.password_hash)) {
    updates.push('password_hash = ?');
    values.push(hash);
  }
  if (existing.role !== 'admin') {
    updates.push('role = ?');
    values.push('admin');
  }
  if (existing.is_active !== 1) {
    updates.push('is_active = ?');
    values.push(1);
  }

  if (!existing.full_name || existing.full_name.trim() === '') {
    updates.push('full_name = ?');
    values.push('المدير الافتراضي');
  }

  if (updates.length > 0) {
    values.push(existing.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = strftime('%s','now') WHERE id = ?`).run(...values);
    console.log('[Database] Updated default admin account:', updates.join(', '));
  } else {
    console.log('[Database] Default admin user already valid');
  }
}

export function query(sql: string, params?: unknown[]): unknown[] {
  if (useMemoryFallback) {
    throw new Error('In-memory fallback does not support raw SQL queries');
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare(sql).all(...(params ?? []));
}

export function run(sql: string, params?: unknown[]): { lastInsertRowid: number | bigint; changes: number } {
  if (useMemoryFallback) {
    throw new Error('In-memory fallback does not support raw SQL runs');
  }
  if (!db) throw new Error('Database not initialized');
  const result = db.prepare(sql).run(...(params ?? []));
  return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
}

export interface AuthUser {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  is_active: number;
}

export function authenticateUser(username: string, password: string): { success: boolean; user?: AuthUser; error?: string } {
  console.log('[Database] Querying user:', username);

  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.username === username);
    if (!user) {
      console.log('[Database] User not found');
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }
    if (user.is_active !== 1) {
      return { success: false, error: 'الحساب معطل، تواصل مع المدير' };
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      console.log('[Database] Wrong password');
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }
    console.log('[Database] User found, success=true');
    return { success: true, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, is_active: user.is_active } };
  }

  if (!db) {
    return { success: false, error: 'قاعدة البيانات غير موجودة' };
  }

  try {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    if (userCount.c === 0) {
      console.warn('[Database] Users table is empty');
      return { success: false, error: 'لم يتم تهيئة النظام' };
    }

    const row = db.prepare('SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ?').get(username) as
      (AuthUser & { password_hash: string }) | undefined;

    if (!row) {
      console.log('[Database] User not found');
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    if (row.is_active !== 1) {
      return { success: false, error: 'الحساب معطل، تواصل مع المدير' };
    }

    if (!bcrypt.compareSync(password, row.password_hash)) {
      console.log('[Database] Wrong password');
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    console.log('[Database] User found, success=true');
    const { password_hash: _, ...safeUser } = row;
    return { success: true, user: safeUser };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown DB error';
    console.error('[Database] authenticateUser error:', message);
    return { success: false, error: 'خطأ في قاعدة البيانات' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User management
// ─────────────────────────────────────────────────────────────────────────────

export interface UserInput {
  username: string;
  full_name?: string | null;
  password?: string;
  role: 'admin' | 'editor' | 'viewer';
  is_active?: number;
}

export function getUsers(): AuthUser[] {
  if (useMemoryFallback) {
    return memoryStore.users.map(u => ({ ...u }));
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT id, username, full_name, role, is_active, created_at, updated_at FROM users ORDER BY id').all() as AuthUser[];
}

export function getUserById(id: number): AuthUser | undefined {
  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.id === id);
    return user ? { ...user } : undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT id, username, full_name, role, is_active, created_at, updated_at FROM users WHERE id = ?').get(id) as AuthUser | undefined;
}

export function getUserByUsername(username: string): AuthUser | undefined {
  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.username === username);
    return user ? { ...user } : undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT id, username, full_name, role, is_active, created_at, updated_at FROM users WHERE username = ?').get(username) as AuthUser | undefined;
}

export function createUser(input: UserInput): { success: boolean; id?: number; error?: string } {
  const { username, full_name, password, role, is_active } = input;
  if (!username || !password || !role) {
    return { success: false, error: 'بيانات المستخدم غير مكتملة' };
  }

  const hash = bcrypt.hashSync(password, 10);

  if (useMemoryFallback) {
    if (memoryStore.users.some(u => u.username === username)) {
      return { success: false, error: 'اسم المستخدم مستخدم مسبقاً' };
    }
    const id = memoryStore.users.length + 1;
    memoryStore.users.push({
      id,
      username,
      password_hash: hash,
      full_name: full_name ?? null,
      role,
      is_active: is_active ?? 1,
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return { success: true, id };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?)"
    ).run(username, hash, full_name ?? null, role, is_active ?? 1);
    return { success: true, id: Number(result.lastInsertRowid) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'اسم المستخدم مستخدم مسبقاً' };
    }
    return { success: false, error: message };
  }
}

export function updateUser(id: number, input: UserInput, actorId?: number): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.id === id);
    if (!user) return { success: false, error: 'المستخدم غير موجود' };
    if (input.username && memoryStore.users.some(u => u.username === input.username && u.id !== id)) {
      return { success: false, error: 'اسم المستخدم مستخدم مسبقاً' };
    }
    if (input.username) user.username = input.username;
    if (input.full_name !== undefined) user.full_name = input.full_name ?? null;
    if (input.role) {
      if (id === actorId && input.role !== 'admin') return { success: false, error: 'لا يمكن خفض صلاحيات حسابك الخاص' };
      user.role = input.role;
    }
    if (input.is_active !== undefined) {
      if (id === actorId && input.is_active !== 1) return { success: false, error: 'لا يمكن تعطيل حسابك الخاص' };
      user.is_active = input.is_active;
    }
    if (input.password) user.password_hash = bcrypt.hashSync(input.password, 10);
    user.updated_at = Date.now();
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: string } | undefined;
  if (!existing) return { success: false, error: 'المستخدم غير موجود' };

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.username !== undefined) {
    sets.push('username = ?');
    values.push(input.username);
  }
  if (input.full_name !== undefined) {
    sets.push('full_name = ?');
    values.push(input.full_name ?? null);
  }
  if (input.password) {
    sets.push('password_hash = ?');
    values.push(bcrypt.hashSync(input.password, 10));
  }
  if (input.role) {
    if (id === actorId && input.role !== 'admin') {
      return { success: false, error: 'لا يمكن خفض صلاحيات حسابك الخاص' };
    }
    sets.push('role = ?');
    values.push(input.role);
  }
  if (input.is_active !== undefined) {
    if (id === actorId && input.is_active !== 1) {
      return { success: false, error: 'لا يمكن تعطيل حسابك الخاص' };
    }
    sets.push('is_active = ?');
    values.push(input.is_active);
  }

  if (sets.length === 0) return { success: true };

  sets.push("updated_at = strftime('%s','now')");
  values.push(id);

  try {
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'اسم المستخدم مستخدم مسبقاً' };
    }
    return { success: false, error: message };
  }
}

export function deleteUser(id: number, actorId?: number): { success: boolean; error?: string } {
  if (id === actorId) {
    return { success: false, error: 'لا يمكن حذف حسابك الخاص' };
  }

  if (useMemoryFallback) {
    const idx = memoryStore.users.findIndex(u => u.id === id);
    if (idx === -1) return { success: false, error: 'المستخدم غير موجود' };
    const admins = memoryStore.users.filter(u => u.role === 'admin');
    if (memoryStore.users[idx].role === 'admin' && admins.length <= 1) {
      return { success: false, error: 'لا يمكن حذف آخر مدير في النظام' };
    }
    memoryStore.users.splice(idx, 1);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
  if (!user) return { success: false, error: 'المستخدم غير موجود' };

  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
    if (adminCount.c <= 1) {
      return { success: false, error: 'لا يمكن حذف آخر مدير في النظام' };
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { success: true };
}

export function toggleUserStatus(id: number, isActive: number, actorId?: number): { success: boolean; error?: string } {
  if (id === actorId && isActive !== 1) {
    return { success: false, error: 'لا يمكن تعطيل حسابك الخاص' };
  }

  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.id === id);
    if (!user) return { success: false, error: 'المستخدم غير موجود' };
    user.is_active = isActive;
    user.updated_at = Date.now();
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  db.prepare("UPDATE users SET is_active = ?, updated_at = strftime('%s','now') WHERE id = ?").run(isActive, id);
  return { success: true };
}

export function addSession(userId: number, username: string, action: 'login' | 'logout'): void {
  const device = `Electron ${process.versions.electron} | ${process.platform}`;
  if (useMemoryFallback) {
    memoryStore.user_sessions.push({
      id: memoryStore.user_sessions.length + 1,
      user_id: userId,
      username,
      action,
      ip_address: 'localhost',
      device_info: action === 'login' ? device : '',
      timestamp: Math.floor(Date.now() / 1000)
    });
    return;
  }
  if (!db) return;
  db.prepare(
    'INSERT INTO user_sessions (user_id, username, action, ip_address, device_info) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, username, action, 'localhost', action === 'login' ? device : '');
}

export function getSessions(userId?: number): InMemorySession[] {
  if (useMemoryFallback) {
    let sessions = memoryStore.user_sessions;
    if (userId !== undefined) sessions = sessions.filter(s => s.user_id === userId);
    return sessions.slice().reverse();
  }
  if (!db) throw new Error('Database not initialized');
  if (userId !== undefined) {
    return db.prepare('SELECT * FROM user_sessions WHERE user_id = ? ORDER BY timestamp DESC').all(userId) as InMemorySession[];
  }
  return db.prepare('SELECT * FROM user_sessions ORDER BY timestamp DESC').all() as InMemorySession[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents / misc
// ─────────────────────────────────────────────────────────────────────────────

export interface FolderPermission {
  folder_id: number;
  can_view: number;
  can_create: number;
  can_edit: number;
  can_delete: number;
}

export function getFolderPermission(userId: number, folderId: number, role: string): FolderPermission | null {
  if (useMemoryFallback) {
    const perm = memoryStore.user_folder_permissions.find(p => p.user_id === userId && p.folder_id === folderId);
    if (perm) {
      return {
        folder_id: perm.folder_id,
        can_view: perm.can_view,
        can_create: perm.can_create,
        can_edit: perm.can_edit,
        can_delete: perm.can_delete
      };
    }
    if (role === 'admin') return { folder_id: folderId, can_view: 1, can_create: 1, can_edit: 1, can_delete: 1 };
    if (role === 'editor') return { folder_id: folderId, can_view: 1, can_create: 0, can_edit: 0, can_delete: 0 };
    return null;
  }

  if (!db) throw new Error('Database not initialized');
  const perm = db.prepare('SELECT folder_id, can_view, can_create, can_edit, can_delete FROM user_folder_permissions WHERE user_id = ? AND folder_id = ?').get(userId, folderId) as FolderPermission | undefined;
  if (perm) return perm;

  if (role === 'admin') return { folder_id: folderId, can_view: 1, can_create: 1, can_edit: 1, can_delete: 1 };
  if (role === 'editor') return { folder_id: folderId, can_view: 1, can_create: 0, can_edit: 0, can_delete: 0 };
  return null;
}

export function getUserFolderPermissions(userId: number): FolderPermission[] {
  if (useMemoryFallback) {
    return memoryStore.user_folder_permissions
      .filter(p => p.user_id === userId)
      .map(p => ({ folder_id: p.folder_id, can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete }));
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT folder_id, can_view, can_create, can_edit, can_delete FROM user_folder_permissions WHERE user_id = ?').all(userId) as FolderPermission[];
}

export function setFolderPermissions(userId: number, permissions: FolderPermission[]): void {
  if (useMemoryFallback) {
    memoryStore.user_folder_permissions = memoryStore.user_folder_permissions.filter(p => p.user_id !== userId);
    for (const perm of permissions) {
      memoryStore.user_folder_permissions.push({
        id: memoryStore.user_folder_permissions.length + 1,
        user_id: userId,
        folder_id: perm.folder_id,
        can_view: perm.can_view ? 1 : 0,
        can_create: perm.can_create ? 1 : 0,
        can_edit: perm.can_edit ? 1 : 0,
        can_delete: perm.can_delete ? 1 : 0
      });
    }
    return;
  }
  if (!db) throw new Error('Database not initialized');
  const insert = db.prepare('INSERT OR REPLACE INTO user_folder_permissions (user_id, folder_id, can_view, can_create, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const perm of permissions) {
      insert.run(userId, perm.folder_id, perm.can_view ? 1 : 0, perm.can_create ? 1 : 0, perm.can_edit ? 1 : 0, perm.can_delete ? 1 : 0);
    }
  });
  tx();
}

export function getTodaySessions(): InMemorySession[] {
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  if (useMemoryFallback) {
    return memoryStore.user_sessions.filter(s => s.timestamp >= startOfDay).reverse();
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM user_sessions WHERE timestamp >= ? ORDER BY timestamp DESC').all(startOfDay) as InMemorySession[];
}

export function addAudit(action: string, docRef?: string, details?: string, username?: string): void {
  if (useMemoryFallback) {
    memoryStore.audit_log.push({ action, doc_ref: docRef, details, username, timestamp: Math.floor(Date.now() / 1000) });
    return;
  }
  if (!db) return;
  db.prepare('INSERT INTO audit_log (action, doc_ref, details, username) VALUES (?, ?, ?, ?)')
    .run(action, docRef ?? null, details ?? null, username ?? null);
}

export function getStats(): Record<string, number> {
  if (useMemoryFallback) {
    const stats: Record<string, number> = { total: memoryStore.documents.length };
    for (const type of memoryStore.document_types) {
      stats[type.label] = memoryStore.documents.filter((d: any) => d.type_id === type.id).length;
    }
    stats['عادي'] = memoryStore.documents.filter((d: any) => d.confidentiality === 'عادي').length;
    stats['سري'] = memoryStore.documents.filter((d: any) => d.confidentiality === 'سري').length;
    stats['سري للغاية'] = memoryStore.documents.filter((d: any) => d.confidentiality === 'سري للغاية').length;
    return stats;
  }
  if (!db) throw new Error('Database not initialized');
  const total = db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number };
  const stats: Record<string, number> = { total: total.c };
  const typeRows = db.prepare('SELECT dt.label, COUNT(d.id) as c FROM document_types dt LEFT JOIN documents d ON d.type_id = dt.id GROUP BY dt.id').all() as Array<{ label: string; c: number }>;
  for (const row of typeRows) {
    stats[row.label] = row.c;
  }
  const confRows = db.prepare("SELECT confidentiality, COUNT(*) as c FROM documents GROUP BY confidentiality").all() as Array<{ confidentiality: string; c: number }>;
  for (const row of confRows) {
    stats[row.confidentiality] = row.c;
  }
  return stats;
}

export function getNextRef(typeId: number, folderId: number): string {
  const year = new Date().getFullYear();
  let prefix = 'X';

  if (useMemoryFallback) {
    const type = memoryStore.document_types.find(t => t.id === typeId);
    prefix = type?.prefix ?? 'X';
    const key = `${prefix}_${folderId}_${year}`;
    const current = memoryStore.counters[key] ?? 0;
    memoryStore.counters[key] = current + 1;
    return `${prefix}-${String(folderId).padStart(3, '0')}-${year}-${String(current + 1).padStart(4, '0')}`;
  }

  if (!db) throw new Error('Database not initialized');
  const type = db.prepare('SELECT prefix FROM document_types WHERE id = ?').get(typeId) as { prefix: string } | undefined;
  prefix = type?.prefix ?? 'X';
  const key = `${prefix}_${folderId}_${year}`;

  db.prepare('INSERT OR IGNORE INTO counters (key, value) VALUES (?, 0)').run(key);
  db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);

  const row = db.prepare('SELECT value FROM counters WHERE key = ?').get(key) as { value: number };
  return `${prefix}-${String(folderId).padStart(3, '0')}-${year}-${String(row.value).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document types
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentTypeInput {
  name: string;
  label: string;
  color: string;
  icon: string;
  prefix: string;
  is_active?: number;
}

export interface DocumentTypeEntry extends DocumentTypeInput {
  id: number;
  is_system: number;
  created_at: number;
}

export function getDocumentTypes(activeOnly = false): DocumentTypeEntry[] {
  if (useMemoryFallback) {
    let types = memoryStore.document_types.map(t => ({ ...t, is_active: t.is_active } as DocumentTypeEntry));
    if (activeOnly) types = types.filter(t => t.is_active === 1);
    return types;
  }
  if (!db) throw new Error('Database not initialized');
  const sql = activeOnly
    ? 'SELECT * FROM document_types WHERE is_active = 1 ORDER BY id'
    : 'SELECT * FROM document_types ORDER BY id';
  return db.prepare(sql).all() as DocumentTypeEntry[];
}

export function getDocumentTypeById(id: number): DocumentTypeEntry | undefined {
  if (useMemoryFallback) {
    return memoryStore.document_types.find(t => t.id === id) as DocumentTypeEntry | undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM document_types WHERE id = ?').get(id) as DocumentTypeEntry | undefined;
}

export function createDocumentType(input: DocumentTypeInput): { success: boolean; id?: number; error?: string } {
  if (!input.name || !input.label || !input.prefix) {
    return { success: false, error: 'بيانات نوع الوثيقة غير مكتملة' };
  }
  if (!/^[A-Z]{1,3}$/.test(input.prefix)) {
    return { success: false, error: 'البادئة يجب أن تكون 1 إلى 3 أحرف إنجليزية كبيرة' };
  }

  if (useMemoryFallback) {
    if (memoryStore.document_types.some(t => t.prefix === input.prefix)) {
      return { success: false, error: 'البادئة مستخدمة مسبقاً' };
    }
    const id = memoryStore.document_types.length + 1;
    memoryStore.document_types.push({
      id,
      name: input.name,
      label: input.label,
      color: input.color,
      icon: input.icon,
      prefix: input.prefix,
      is_active: input.is_active ?? 1,
      is_system: 0,
      created_at: Date.now()
    });
    return { success: true, id };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const result = db.prepare(
      'INSERT INTO document_types (name, label, color, icon, prefix, is_active) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(input.name, input.label, input.color, input.icon, input.prefix, input.is_active ?? 1);
    return { success: true, id: Number(result.lastInsertRowid) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'البادئة مستخدمة مسبقاً' };
    }
    return { success: false, error: message };
  }
}

export function updateDocumentType(id: number, input: Partial<DocumentTypeInput>): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const type = memoryStore.document_types.find(t => t.id === id);
    if (!type) return { success: false, error: 'نوع الوثيقة غير موجود' };
    if (input.prefix && memoryStore.document_types.some(t => t.prefix === input.prefix && t.id !== id)) {
      return { success: false, error: 'البادئة مستخدمة مسبقاً' };
    }
    if (input.name) type.name = input.name;
    if (input.label) type.label = input.label;
    if (input.color) type.color = input.color;
    if (input.icon) type.icon = input.icon;
    if (input.prefix) type.prefix = input.prefix;
    if (input.is_active !== undefined) type.is_active = input.is_active;
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.label !== undefined) { sets.push('label = ?'); values.push(input.label); }
  if (input.color !== undefined) { sets.push('color = ?'); values.push(input.color); }
  if (input.icon !== undefined) { sets.push('icon = ?'); values.push(input.icon); }
  if (input.prefix !== undefined) {
    if (!/^[A-Z]{1,3}$/.test(input.prefix)) {
      return { success: false, error: 'البادئة يجب أن تكون 1 إلى 3 أحرف إنجليزية كبيرة' };
    }
    sets.push('prefix = ?'); values.push(input.prefix);
  }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }
  if (sets.length === 0) return { success: true };
  values.push(id);
  try {
    db.prepare(`UPDATE document_types SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE constraint failed')) {
      return { success: false, error: 'البادئة مستخدمة مسبقاً' };
    }
    return { success: false, error: message };
  }
}

export function deleteDocumentType(id: number): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const type = memoryStore.document_types.find(t => t.id === id);
    if (!type) return { success: false, error: 'نوع الوثيقة غير موجود' };
    if (type.is_system) return { success: false, error: 'لا يمكن حذف نوع وثيقة نظامي' };
    if (memoryStore.documents.some(d => d.type_id === id)) {
      return { success: false, error: 'لا يمكن حذف نوع يحتوي على وثائق' };
    }
    memoryStore.document_types = memoryStore.document_types.filter(t => t.id !== id);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const type = db.prepare('SELECT is_system FROM document_types WHERE id = ?').get(id) as { is_system: number } | undefined;
  if (!type) return { success: false, error: 'نوع الوثيقة غير موجود' };
  if (type.is_system === 1) return { success: false, error: 'لا يمكن حذف نوع وثيقة نظامي' };
  const docCount = db.prepare('SELECT COUNT(*) as c FROM documents WHERE type_id = ?').get(id) as { c: number };
  if (docCount.c > 0) return { success: false, error: 'لا يمكن حذف نوع يحتوي على وثائق' };
  db.prepare('DELETE FROM document_types WHERE id = ?').run(id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder categories
// ─────────────────────────────────────────────────────────────────────────────

export interface FolderInput {
  name: string;
  group_name: string;
  is_active?: number;
}

export interface FolderEntry {
  id: number;
  name: string;
  group_name: string;
  is_system: number;
  is_active: number;
  created_by?: number;
  created_at?: number;
  updated_at?: number;
  document_count?: number;
}

export function getFolders(activeOnly = false): FolderEntry[] {
  if (useMemoryFallback) {
    let folders = memoryStore.folders.map(f => ({ ...f } as FolderEntry));
    if (activeOnly) folders = folders.filter(f => f.is_active === 1);
    return folders;
  }
  if (!db) throw new Error('Database not initialized');
  const sql = activeOnly
    ? 'SELECT * FROM folders WHERE is_active = 1 ORDER BY id'
    : 'SELECT * FROM folders ORDER BY id';
  return db.prepare(sql).all() as FolderEntry[];
}

export function getFolderGroups(): string[] {
  const folders = getFolders();
  return Array.from(new Set(folders.map(f => f.group_name)));
}

export function getFolderById(id: number): FolderEntry | undefined {
  if (useMemoryFallback) {
    return memoryStore.folders.find(f => f.id === id) as FolderEntry | undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderEntry | undefined;
}

export function createFolder(input: FolderInput, createdBy?: number): { success: boolean; id?: number; error?: string } {
  if (!input.name || !input.group_name) {
    return { success: false, error: 'بيانات التصنيف غير مكتملة' };
  }

  if (useMemoryFallback) {
    const id = Math.max(0, ...memoryStore.folders.map(f => f.id)) + 1;
    memoryStore.folders.push({
      id,
      name: input.name,
      group_name: input.group_name,
      is_system: 0,
      is_active: input.is_active ?? 1,
      created_by: createdBy ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return { success: true, id };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const result = db.prepare(
      'INSERT INTO folders (name, group_name, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, strftime("%s","now"), strftime("%s","now"))'
    ).run(input.name, input.group_name, input.is_active ?? 1, createdBy ?? null);
    return { success: true, id: Number(result.lastInsertRowid) };
  } catch (err: unknown) {
    return { success: false, error: (err instanceof Error ? err.message : 'Unknown error') };
  }
}

export function updateFolder(id: number, input: Partial<FolderInput>): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const folder = memoryStore.folders.find(f => f.id === id);
    if (!folder) return { success: false, error: 'التصنيف غير موجود' };
    if (input.name) folder.name = input.name;
    if (input.group_name) folder.group_name = input.group_name;
    if (input.is_active !== undefined) folder.is_active = input.is_active;
    folder.updated_at = Date.now();
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.group_name !== undefined) { sets.push('group_name = ?'); values.push(input.group_name); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }
  if (sets.length === 0) return { success: true };
  sets.push("updated_at = strftime('%s','now')");
  values.push(id);
  try {
    db.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err instanceof Error ? err.message : 'Unknown error') };
  }
}

export function deleteFolder(id: number): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const folder = memoryStore.folders.find(f => f.id === id);
    if (!folder) return { success: false, error: 'التصنيف غير موجود' };
    if (folder.is_system) return { success: false, error: 'لا يمكن حذف تصنيف نظامي' };
    if (memoryStore.documents.some(d => d.folder_id === id)) {
      return { success: false, error: 'لا يمكن حذف تصنيف يحتوي على وثائق' };
    }
    memoryStore.folders = memoryStore.folders.filter(f => f.id !== id);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const folder = db.prepare('SELECT is_system FROM folders WHERE id = ?').get(id) as { is_system: number } | undefined;
  if (!folder) return { success: false, error: 'التصنيف غير موجود' };
  if (folder.is_system === 1) return { success: false, error: 'لا يمكن حذف تصنيف نظامي' };
  const docCount = db.prepare('SELECT COUNT(*) as c FROM documents WHERE folder_id = ?').get(id) as { c: number };
  if (docCount.c > 0) return { success: false, error: 'لا يمكن حذف تصنيف يحتوي على وثائق' };
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Security / verification codes
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificationCode {
  id?: number;
  code?: string;
  code_hash?: string;
  generated_at?: number;
  expires_at?: number;
  is_active?: number;
  generated_by?: number;
}

export function getCurrentVerificationCode(): VerificationCode | null {
  const now = Math.floor(Date.now() / 1000);
  if (useMemoryFallback) {
    return memoryStore.system_verification_codes
      .filter(c => c.is_active === 1 && c.expires_at > now)
      .sort((a, b) => b.generated_at - a.generated_at)[0] ?? null;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare(
    'SELECT * FROM system_verification_codes WHERE is_active = 1 AND expires_at > ? ORDER BY generated_at DESC LIMIT 1'
  ).get(now) as VerificationCode | null;
}

export function generateVerificationCode(adminId: number): { success: boolean; code?: string; error?: string; expiresAt?: number } {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (24 * 60 * 60);

  if (useMemoryFallback) {
    for (const c of memoryStore.system_verification_codes) c.is_active = 0;
    memoryStore.system_verification_codes.push({
      id: memoryStore.system_verification_codes.length + 1,
      code,
      code_hash: codeHash,
      generated_at: now,
      expires_at: expiresAt,
      is_active: 1,
      generated_by: adminId
    });
    return { success: true, code, expiresAt };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const tx = db.transaction(() => {
      db!.prepare('UPDATE system_verification_codes SET is_active = 0').run();
      // Store plaintext code for admin display and hash for secure verification.
      db!.prepare(
        'INSERT INTO system_verification_codes (code, code_hash, generated_at, expires_at, is_active, generated_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(code, codeHash, now, expiresAt, 1, adminId);
    });
    tx();
    return { success: true, code, expiresAt };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل توليد الرمز' };
  }
}

export function verifySystemCode(code: string): { valid: boolean; error?: string } {
  if (!code || code.length !== 6) return { valid: false, error: 'الرمز يجب أن يكون 6 أرقام' };
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const now = Math.floor(Date.now() / 1000);

  if (useMemoryFallback) {
    const found = memoryStore.system_verification_codes.find(
      c => c.is_active === 1 && c.expires_at > now && c.code_hash === codeHash
    );
    return { valid: !!found, error: found ? undefined : 'الرمز غير صحيح أو منتهي الصلاحية' };
  }

  if (!db) return { valid: false, error: 'قاعدة البيانات غير موجودة' };
  const found = db.prepare(
    'SELECT id FROM system_verification_codes WHERE is_active = 1 AND expires_at > ? AND code_hash = ?'
  ).get(now, codeHash);
  return { valid: !!found, error: found ? undefined : 'الرمز غير صحيح أو منتهي الصلاحية' };
}

export function logDocumentAccess(documentId: number, userId: number, username: string, accessType: 'view' | 'edit', confidentiality: string, method?: string): void {
  if (useMemoryFallback) {
    memoryStore.document_access_log.push({
      id: memoryStore.document_access_log.length + 1,
      document_id: documentId,
      user_id: userId,
      user_username: username,
      access_type: accessType,
      confidentiality_level: confidentiality,
      verification_method: method ?? null,
      timestamp: Math.floor(Date.now() / 1000)
    });
    return;
  }
  if (!db) return;
  db.prepare(
    'INSERT INTO document_access_log (document_id, user_id, user_username, access_type, confidentiality_level, verification_method) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(documentId, userId, username, accessType, confidentiality, method ?? null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Password reset
// ─────────────────────────────────────────────────────────────────────────────

export interface PasswordResetRequest {
  id?: number;
  user_id: number;
  username: string;
  request_date?: number;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: number;
  approved_at?: number;
  new_password_hash?: string;
}

export function requestPasswordReset(userId: number, username: string): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const existing = memoryStore.password_reset_requests.find(r => r.user_id === userId && r.status === 'pending');
    if (existing) return { success: false, error: 'يوجد طلب معلق مسبقاً لهذا المستخدم' };
    memoryStore.password_reset_requests.push({
      id: memoryStore.password_reset_requests.length + 1,
      user_id: userId,
      username,
      request_date: Math.floor(Date.now() / 1000),
      status: 'pending'
    });
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const existing = db.prepare("SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'").get(userId);
  if (existing) return { success: false, error: 'يوجد طلب معلق مسبقاً لهذا المستخدم' };
  try {
    db.prepare(
      'INSERT INTO password_reset_requests (user_id, username, status) VALUES (?, ?, ?)'
    ).run(userId, username, 'pending');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل إنشاء الطلب' };
  }
}

export function getPendingPasswordResetRequests(): PasswordResetRequest[] {
  if (useMemoryFallback) {
    return memoryStore.password_reset_requests.filter(r => r.status === 'pending');
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare("SELECT * FROM password_reset_requests WHERE status = 'pending' ORDER BY request_date DESC").all() as PasswordResetRequest[];
}

export function approvePasswordReset(requestId: number, newPassword: string, approvedBy: number): { success: boolean; error?: string } {
  const hash = bcrypt.hashSync(newPassword, 10);

  if (useMemoryFallback) {
    const req = memoryStore.password_reset_requests.find(r => r.id === requestId);
    if (!req) return { success: false, error: 'الطلب غير موجود' };
    const user = memoryStore.users.find(u => u.id === req.user_id);
    if (!user) return { success: false, error: 'المستخدم غير موجود' };
    user.password_hash = hash;
    req.status = 'approved';
    req.approved_by = approvedBy;
    req.approved_at = Math.floor(Date.now() / 1000);
    req.new_password_hash = hash;
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const req = db.prepare('SELECT user_id FROM password_reset_requests WHERE id = ?').get(requestId) as { user_id: number } | undefined;
  if (!req) return { success: false, error: 'الطلب غير موجود' };
  const tx = db.transaction(() => {
    db!.prepare('UPDATE users SET password_hash = ?, updated_at = strftime("%s","now") WHERE id = ?').run(hash, req.user_id);
    db!.prepare(
      'UPDATE password_reset_requests SET status = ?, approved_by = ?, approved_at = strftime("%s","now"), new_password_hash = ? WHERE id = ?'
    ).run('approved', approvedBy, hash, requestId);
  });
  tx();
  return { success: true };
}

export function rejectPasswordReset(requestId: number): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const req = memoryStore.password_reset_requests.find(r => r.id === requestId);
    if (!req) return { success: false, error: 'الطلب غير موجود' };
    req.status = 'rejected';
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  db.prepare("UPDATE password_reset_requests SET status = 'rejected' WHERE id = ?").run(requestId);
  return { success: true };
}

export function adminResetPassword(userId: number, newPassword: string): { success: boolean; error?: string } {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
  }
  const hash = bcrypt.hashSync(newPassword, 10);

  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return { success: false, error: 'المستخدم غير موجود' };
    user.password_hash = hash;
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  db.prepare('UPDATE users SET password_hash = ?, updated_at = strftime("%s","now") WHERE id = ?').run(hash, userId);
  return { success: true };
}

export function changeOwnPassword(userId: number, currentPassword: string, newPassword: string): { success: boolean; error?: string } {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' };
  }

  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.id === userId);
    if (!user) return { success: false, error: 'المستخدم غير موجود' };
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return { success: false, error: 'كلمة المرور الحالية غير صحيحة' };
    }
    user.password_hash = bcrypt.hashSync(newPassword, 10);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
  if (!user) return { success: false, error: 'المستخدم غير موجود' };
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return { success: false, error: 'كلمة المرور الحالية غير صحيحة' };
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = strftime("%s","now") WHERE id = ?').run(hash, userId);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Annual closing
// ─────────────────────────────────────────────────────────────────────────────

export interface ArchivedYear {
  year: number;
  archived_at?: number;
  archived_by?: number;
  archived_by_name?: string;
  document_count?: number;
  backup_path?: string;
  notes?: string;
}

export function getArchivedYears(): ArchivedYear[] {
  if (useMemoryFallback) {
    return memoryStore.archived_years.map(y => ({ ...y }));
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare(`
    SELECT ay.*, COALESCE(u.full_name, u.username, 'غير معروف') as archived_by_name
    FROM archived_years ay
    LEFT JOIN users u ON u.id = ay.archived_by
    ORDER BY ay.year DESC
  `).all() as ArchivedYear[];
}

export function closeYear(year: number, adminId: number): { success: boolean; message?: string; error?: string; backupPath?: string } {
  if (useMemoryFallback) {
    return { success: false, error: 'الجرد السنوي غير مدعوم في وضع الذاكرة المؤقت' };
  }
  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };

  try {
    const userData = app.getPath('userData');
    const backupDir = path.join(userData, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const dbPath = path.join(userData, 'archive.db');
    const docCount = db.prepare('SELECT COUNT(*) as c FROM documents WHERE strftime("%Y", date) = ?').get(year.toString()) as { c: number };
    if (docCount.c === 0) {
      return { success: false, error: 'لا توجد وثائق لإغلاقها في هذه السنة' };
    }

    const backupPath = path.join(backupDir, `archive_${year}_${Date.now()}.db`);
    fs.copyFileSync(dbPath, backupPath);

    const tx = db.transaction(() => {
      db!.exec(`CREATE TABLE IF NOT EXISTS archived_documents_${year} AS SELECT * FROM documents WHERE 1=0`);
      db!.prepare(`DELETE FROM archived_documents_${year}`).run();
      db!.prepare(`INSERT INTO archived_documents_${year} SELECT * FROM documents WHERE strftime("%Y", date) = ?`).run(year.toString());
      db!.prepare('DELETE FROM documents WHERE strftime("%Y", date) = ?').run(year.toString());
      db!.prepare('DELETE FROM audit_log WHERE strftime("%Y", datetime(timestamp, "unixepoch")) = ?').run(year.toString());
      db!.prepare('DELETE FROM counters').run();
      db!.prepare('INSERT OR REPLACE INTO archived_years (year, archived_by, document_count, backup_path) VALUES (?, ?, ?, ?)')
        .run(year, adminId, docCount.c, backupPath);
    });
    tx();

    return { success: true, message: `تم إغلاق سنة ${year} بنجاح`, backupPath };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل إغلاق السنة' };
  }
}

export function getArchivedDocuments(year: number): unknown[] {
  if (useMemoryFallback) {
    return [];
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare(`SELECT * FROM archived_documents_${year} ORDER BY created_at DESC`).all();
}

// ─────────────────────────────────────────────────────────────────────────────
// Export / import
// ─────────────────────────────────────────────────────────────────────────────

export function exportData(): string {
  if (useMemoryFallback) {
    return JSON.stringify({
      folders: memoryStore.folders,
      documents: memoryStore.documents,
      document_types: memoryStore.document_types,
      counters: memoryStore.counters,
      audit_log: memoryStore.audit_log,
      users: memoryStore.users,
      system_verification_codes: memoryStore.system_verification_codes,
      document_access_log: memoryStore.document_access_log,
      password_reset_requests: memoryStore.password_reset_requests,
      archived_years: memoryStore.archived_years
    }, null, 2);
  }
  if (!db) throw new Error('Database not initialized');
  const folders = query('SELECT * FROM folders');
  const documents = query('SELECT * FROM documents');
  const document_types = query('SELECT * FROM document_types');
  const counters = query('SELECT * FROM counters');
  const audit_log = query('SELECT * FROM audit_log');
  const users = query('SELECT * FROM users');
  const system_verification_codes = query('SELECT * FROM system_verification_codes');
  const document_access_log = query('SELECT * FROM document_access_log');
  const password_reset_requests = query('SELECT * FROM password_reset_requests');
  const archived_years = query('SELECT * FROM archived_years');

  return JSON.stringify({
    folders, documents, document_types, counters, audit_log, users,
    system_verification_codes, document_access_log, password_reset_requests, archived_years
  }, null, 2);
}

export function importData(jsonData: string, mode: 'merge' | 'replace'): { success: boolean; message: string } {
  if (useMemoryFallback) {
    return { success: false, message: 'الاستيراد غير مدعوم في وضع الذاكرة المؤقت' };
  }
  if (!db) throw new Error('Database not initialized');
  try {
    const data = JSON.parse(jsonData) as {
      folders?: Array<Record<string, unknown>>;
      documents?: Array<Record<string, unknown>>;
      document_types?: Array<Record<string, unknown>>;
      counters?: Array<{ key: string; value: number }>;
      audit_log?: Array<Record<string, unknown>>;
      users?: Array<Record<string, unknown>>;
      system_verification_codes?: Array<Record<string, unknown>>;
      document_access_log?: Array<Record<string, unknown>>;
      password_reset_requests?: Array<Record<string, unknown>>;
      archived_years?: Array<Record<string, unknown>>;
    };

    if (mode === 'replace') {
      db.exec(`
        DELETE FROM archived_years;
        DELETE FROM password_reset_requests;
        DELETE FROM document_access_log;
        DELETE FROM system_verification_codes;
        DELETE FROM audit_log;
        DELETE FROM documents;
        DELETE FROM counters;
        DELETE FROM document_types;
        DELETE FROM folders;
        DELETE FROM users;
      `);
    }

    const insertFolder = db.prepare('INSERT OR REPLACE INTO folders (id, name, group_name, is_system, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertDocType = db.prepare('INSERT OR REPLACE INTO document_types (id, name, label, color, icon, prefix, is_active, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents (
        id, ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, author, address, target, content, input_method,
        date, body, notes, status, signature_base64, attachments_json, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCounter = db.prepare('INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)');
    const insertAudit = db.prepare('INSERT OR REPLACE INTO audit_log (id, action, doc_ref, details, username, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
    const insertUser = db.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

    const tx = db.transaction(() => {
      if (data.folders) {
        for (const item of data.folders) {
          insertFolder.run(
            (item.id as number | undefined) ?? null,
            item.name,
            item.group_name,
            item.is_system ?? 0,
            item.is_active ?? 1,
            item.created_by ?? null,
            item.created_at ?? new Date().toISOString(),
            item.updated_at ?? new Date().toISOString()
          );
        }
      }
      if (data.document_types) {
        for (const item of data.document_types) {
          insertDocType.run(
            (item.id as number | undefined) ?? null,
            item.name,
            item.label,
            item.color ?? '#2563eb',
            item.icon ?? '📄',
            item.prefix,
            item.is_active ?? 1,
            item.is_system ?? 0,
            item.created_at ?? new Date().toISOString()
          );
        }
      }
      if (data.documents) {
        for (const item of data.documents) {
          insertDoc.run(
            (item.id as number | undefined) ?? null,
            item.ref_number,
            item.type_id ?? 1,
            item.folder_id,
            item.confidentiality ?? 'عادي',
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
            item.full_name ?? null,
            item.role,
            item.is_active ?? 1,
            item.created_at ?? new Date().toISOString(),
            item.updated_at ?? new Date().toISOString()
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
