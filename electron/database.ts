import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { app } from 'electron';
import crypto from 'crypto';

// Precomputed bcrypt hash of a throwaway password, used by authenticateUser to
// equalize timing between "unknown user" and "wrong password" paths.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

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
  org_unit_id: number | null;
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
  message_author?: string;
  message_preparer?: string;
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
  org_unit_id?: number | null;
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

interface InMemoryUserVerificationCode {
  id: number;
  user_id: number;
  code_hash: string;
  status: 'active' | 'used' | 'revoked';
  generated_by: number | null;
  generated_at: number;
  expires_at: number;
  used_at: number | null;
  used_document_id: number | null;
  revoked_by: number | null;
  revoked_at: number | null;
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

interface InMemoryMasterList {
  id: number;
  list_type: string;
  name: string;
  name_en?: string | null;
  is_active: number;
  created_at: number;
}

interface InMemoryArchiveSequence {
  id: number;
  year: number;
  last_number: number;
  created_at: number;
  updated_at: number;
}

interface InMemoryOrgUnit {
  id: number;
  name: string;
  unit_type: 'administration' | 'section';
  parent_id: number | null;
  is_active: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
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
  user_verification_codes: InMemoryUserVerificationCode[];
  document_access_log: InMemoryAccessLog[];
  password_reset_requests: InMemoryResetRequest[];
  archived_years: InMemoryArchivedYear[];
  master_lists: InMemoryMasterList[];
  archive_sequences: InMemoryArchiveSequence[];
  org_units: InMemoryOrgUnit[];
  current_archive_year: number | null;
}

const memoryStore: InMemoryStore = {
  users: [{
    id: 1,
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
    full_name: 'المدير العام',
    role: 'general_manager',
    org_unit_id: null,
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
  user_verification_codes: [],
  document_access_log: [],
  password_reset_requests: [],
  archived_years: [],
  master_lists: [
    { id: 1, list_type: 'message_author', name: 'أحمد علي', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 2, list_type: 'message_author', name: 'محمد خالد', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 3, list_type: 'sender', name: 'وزارة الدفاع', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 4, list_type: 'sender', name: 'القيادة العامة', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 5, list_type: 'receiver', name: 'مركز البنيان', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 6, list_type: 'receiver', name: 'الإدارة العامة', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 7, list_type: 'department', name: 'قسم التدريب', name_en: null, is_active: 1, created_at: Date.now() },
    { id: 8, list_type: 'department', name: 'قسم الصيانة', name_en: null, is_active: 1, created_at: Date.now() }
  ],
  archive_sequences: [],
  org_units: [],
  current_archive_year: null
};

let useMemoryFallback = false;
let db: Database.Database | null = null;
let initError: string | null = null;
let dbPath: string | null = null;

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
    dbPath = path.join(userData, 'archive.db');
    console.log('[Database] Opening SQLite DB at:', dbPath);

    db = new Database(dbPath);
    console.log('[Database] SQLite connection established');
    // Wait for the write lock instead of failing immediately with SQLITE_BUSY
    // if this file is ever touched concurrently (extra window, external tool).
    db.pragma('busy_timeout = 5000');

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
        message_author TEXT,
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

      -- One row per calendar year. last_number only ever increments (via
      -- getNextArchiveSequenceNumber's transaction below); it is never derived
      -- from COUNT(*) on documents, so deleting a document never frees its
      -- number back up for reuse.
      CREATE TABLE IF NOT EXISTS archive_sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL UNIQUE,
        last_number INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );

      -- Single row (id=1) holding the archive year currently open for new
      -- documents. Decouples ref-number generation from the OS clock, so
      -- closeYear() can advance it immediately instead of waiting for the
      -- real calendar to roll over. NULL (or missing row) means "not set
      -- yet" — callers fall back to the OS calendar year, so pre-existing
      -- databases behave exactly as before until a year is first closed.
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_archive_year INTEGER
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

      CREATE TABLE IF NOT EXISTS user_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','used','revoked')),
        generated_by INTEGER,
        generated_at INTEGER DEFAULT (strftime('%s','now')),
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        used_document_id INTEGER,
        revoked_by INTEGER,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_uvc_user_status ON user_verification_codes(user_id, status);

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

      CREATE TABLE IF NOT EXISTS master_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_type TEXT NOT NULL CHECK(list_type IN ('message_author', 'sender', 'receiver', 'department', 'preparer')),
        name TEXT NOT NULL,
        name_en TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS org_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        unit_type TEXT NOT NULL CHECK(unit_type IN ('administration','section')),
        parent_id INTEGER REFERENCES org_units(id),
        is_active INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);

      CREATE INDEX IF NOT EXISTS idx_master_lists_type ON master_lists(list_type);
      CREATE INDEX IF NOT EXISTS idx_master_lists_name ON master_lists(name);
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
    migrateRolesV2();
    seedAdmin();
    migrateDocumentsAuthorRename();
    migrateDocumentsColumns();
    seedDocumentTypes();
    migrateDocumentTypeId();
    migrateFolderSystemFlags();
    migrateDocumentConfidentiality();
    migrateDocumentBarcode();
    migrateMasterListsPreparerType();
    migrateMasterListsAuthorRename();
    seedMasterLists();
    createPostMigrationIndexes();
    migrateDocumentsOrgUnit();
    migrateDocumentsArchiveYear();

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

// Renames the documents author/preparer columns to their canonical names:
// author → message_author (منشئ الرسالة) and writer_name → message_preparer
// (معد الرسالة). Must run BEFORE migrateDocumentsColumns, which would otherwise
// ADD the new columns as empty columns first and block the renames. Also applied
// to every archived_documents_<year> snapshot table, which inherits the old
// column names from `CREATE TABLE ... AS SELECT * FROM documents` at closing
// time. Idempotent: each rename is guarded by PRAGMA table_info.
function migrateDocumentsAuthorRename(): void {
  if (!db || useMemoryFallback) return;
  const renames: Array<[string, string]> = [
    ['author', 'message_author'],
    ['writer_name', 'message_preparer']
  ];
  const tables = ['documents'];
  try {
    const archived = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'archived_documents_%'"
    ).all() as Array<{ name: string }>;
    for (const row of archived) tables.push(row.name);
  } catch (err) {
    console.error('[Database] Failed to enumerate archived document tables:', err instanceof Error ? err.message : err);
  }
  for (const table of tables) {
    try {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      const names = new Set(columns.map(c => c.name));
      for (const [oldName, newName] of renames) {
        if (names.has(oldName) && !names.has(newName)) {
          db.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName}`);
          console.log(`[Database] Renamed ${table}.${oldName} to ${newName}`);
        }
      }
    } catch (err) {
      console.error(`[Database] Failed to rename author columns on ${table}:`, err instanceof Error ? err.message : err);
    }
  }
}

function migrateDocumentsColumns(): void {
  if (!db || useMemoryFallback) return;
  const columns = ['message_author', 'message_preparer', 'address', 'target', 'content', 'input_method', 'status', 'created_by'];
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

function seedMasterLists(): void {
  if (!db || useMemoryFallback) return;
  const count = db.prepare('SELECT COUNT(*) as c FROM master_lists').get() as { c: number };
  if (count.c > 0) return;
  const insert = db.prepare(`
    INSERT INTO master_lists (list_type, name, name_en, is_active) VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    insert.run('message_author', 'أحمد علي', null, 1);
    insert.run('message_author', 'محمد خالد', null, 1);
    insert.run('sender', 'وزارة الدفاع', null, 1);
    insert.run('sender', 'القيادة العامة', null, 1);
    insert.run('receiver', 'مركز البنيان', null, 1);
    insert.run('receiver', 'الإدارة العامة', null, 1);
    insert.run('department', 'قسم التدريب', null, 1);
    insert.run('department', 'قسم الصيانة', null, 1);
  });
  tx();
  console.log('[Database] Seeded master lists');
}

// Widens master_lists.list_type's CHECK constraint to allow 'preparer' (معد الرسالة)
// alongside the original author/sender/receiver/department values. SQLite can't
// ALTER a CHECK constraint in place, so this rebuilds the table under a transaction:
// rename → recreate with the wider CHECK → copy all rows → drop the renamed copy.
// Guarded by inspecting sqlite_master so it only runs once, and is a no-op (including
// on the in-memory fallback, which never enforces this constraint) once already applied.
function migrateMasterListsPreparerType(): void {
  if (!db || useMemoryFallback) return;
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'master_lists'").get() as { sql: string } | undefined;
  if (!tableSql || tableSql.sql.includes('preparer')) return;

  const tx = db.transaction(() => {
    db!.exec('ALTER TABLE master_lists RENAME TO master_lists_old');
    db!.exec(`
      CREATE TABLE master_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_type TEXT NOT NULL CHECK(list_type IN ('author', 'sender', 'receiver', 'department', 'preparer')),
        name TEXT NOT NULL,
        name_en TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
    db!.exec('INSERT INTO master_lists (id, list_type, name, name_en, is_active, created_at) SELECT id, list_type, name, name_en, is_active, created_at FROM master_lists_old');
    db!.exec('DROP TABLE master_lists_old');
    db!.exec('CREATE INDEX IF NOT EXISTS idx_master_lists_type ON master_lists(list_type)');
    db!.exec('CREATE INDEX IF NOT EXISTS idx_master_lists_name ON master_lists(name)');
  });
  tx();
  console.log('[Database] Widened master_lists.list_type to allow preparer');
}

// Renames the master_lists.list_type value 'author' → 'message_author'
// (منشئ الرسالة, message author — distinct from documents.created_by, the file
// creator). list_type is guarded by a CHECK constraint that SQLite can't ALTER
// in place, so this follows the same rebuild pattern as
// migrateMasterListsPreparerType above: rename → recreate with the new CHECK →
// copy all rows (converting 'author' on the way) → drop the renamed copy.
// Runs before seedMasterLists so fresh seeds ('message_author') never hit an
// old CHECK. Guarded by inspecting sqlite_master so it only runs once.
function migrateMasterListsAuthorRename(): void {
  if (!db || useMemoryFallback) return;
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'master_lists'").get() as { sql: string } | undefined;
  if (!tableSql || tableSql.sql.includes('message_author')) return;

  const tx = db.transaction(() => {
    db!.exec('ALTER TABLE master_lists RENAME TO master_lists_old');
    db!.exec(`
      CREATE TABLE master_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_type TEXT NOT NULL CHECK(list_type IN ('message_author', 'sender', 'receiver', 'department', 'preparer')),
        name TEXT NOT NULL,
        name_en TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
    db!.exec(`INSERT INTO master_lists (id, list_type, name, name_en, is_active, created_at)
      SELECT id, CASE WHEN list_type = 'author' THEN 'message_author' ELSE list_type END, name, name_en, is_active, created_at
      FROM master_lists_old`);
    db!.exec('DROP TABLE master_lists_old');
    db!.exec('CREATE INDEX IF NOT EXISTS idx_master_lists_type ON master_lists(list_type)');
    db!.exec('CREATE INDEX IF NOT EXISTS idx_master_lists_name ON master_lists(name)');
  });
  tx();
  console.log("[Database] Renamed master_lists.list_type 'author' to 'message_author'");
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
        message_author TEXT,
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
        (id, ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, message_author, address, target, content, input_method,
         date, body, notes, status, signature_base64, attachments_json, created_at, updated_at, created_by)
      SELECT
        id, ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, message_author, address, target, content, input_method,
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
    if (names.has('subject')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_documents_subject ON documents(subject)');
    }
  } catch (err) {
    console.warn('[Database] Failed to create post-migration indexes:', err instanceof Error ? err.message : err);
  }
}

// Adds documents.barcode (idempotent) and (re)syncs it from each row's own
// ref_number so every document's barcode always matches its reference number
// — this also repairs rows whose barcode was stamped by an older scheme.
function migrateDocumentBarcode(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'barcode')) {
    try {
      db.exec('ALTER TABLE documents ADD COLUMN barcode TEXT');
      console.log('[Database] Added documents.barcode column');
    } catch (err) {
      console.warn('[Database] Failed to add barcode column:', err instanceof Error ? err.message : err);
      return;
    }
  }

  const rows = db.prepare('SELECT id, ref_number, barcode FROM documents').all() as Array<{ id: number; ref_number: string; barcode: string | null }>;
  const stale = rows.filter(row => row.ref_number && generateDocumentBarcode(row.ref_number) !== row.barcode);
  if (stale.length > 0) {
    const update = db.prepare('UPDATE documents SET barcode = ? WHERE id = ?');
    const tx = db.transaction((items: typeof stale) => {
      for (const row of items) {
        update.run(generateDocumentBarcode(row.ref_number), row.id);
      }
    });
    tx(stale);
    console.log('[Database] Synced barcode for', stale.length, 'document(s)');
  }

  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_barcode ON documents(barcode)');
  } catch (err) {
    console.warn('[Database] Failed to create barcode index:', err instanceof Error ? err.message : err);
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

function migrateRolesV2(): void {
  if (!db || useMemoryFallback) return;

  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string } | undefined;
  if (tableInfo && tableInfo.sql && tableInfo.sql.includes('general_manager')) {
    // Already migrated to the 5-role schema.
    return;
  }

  try {
    if (dbPath && fs.existsSync(dbPath)) {
      const userData = app.getPath('userData');
      const backupPath = path.join(userData, `archive_pre_roles_v2_${Date.now()}.db`);
      fs.copyFileSync(dbPath, backupPath);
      console.log('[Database] Backed up database before roles-v2 migration to', backupPath);
    }
  } catch (err) {
    console.error('[Database] Failed to back up database before roles-v2 migration:', err instanceof Error ? err.message : err);
  }

  // Disable foreign keys for the duration of the table rebuild. This
  // better-sqlite3 build enables foreign_keys by default, so `DROP TABLE users`
  // performs an implicit DELETE of every row, which violates child tables that
  // reference users(id) without ON DELETE CASCADE (user_folder_permissions,
  // password_reset_requests, ...) and raises "FOREIGN KEY constraint failed".
  // PRAGMA foreign_keys is a silent no-op inside a transaction, so it must be
  // toggled outside — this is SQLite's official table-rebuild recipe.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) db.pragma('foreign_keys = OFF');
  try {
    const tx = db.transaction(() => {
      db!.exec(`
        CREATE TABLE users_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          full_name TEXT,
          role TEXT NOT NULL DEFAULT 'employee'
            CHECK(role IN ('general_manager','deputy_manager','dept_head','section_head','employee')),
          org_unit_id INTEGER REFERENCES org_units(id),
          is_active INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        );
      `);
      // Preserve already-valid 5-role values (idempotent re-runs, and recovery
      // from a half-applied migration where seedAdmin already stamped a new
      // role); map the legacy admin/editor/viewer model otherwise.
      db!.exec(`
        INSERT INTO users_v2 (id, username, password_hash, full_name, role, org_unit_id, is_active, created_at, updated_at)
        SELECT id, username, password_hash, full_name,
          CASE
            WHEN role IN ('general_manager','deputy_manager','dept_head','section_head','employee') THEN role
            WHEN role = 'admin' AND id = (SELECT MIN(id) FROM users WHERE role = 'admin') THEN 'general_manager'
            WHEN role = 'admin' THEN 'deputy_manager'
            ELSE 'employee'
          END,
          NULL, is_active, created_at, updated_at
        FROM users;
      `);
      db!.exec('DROP TABLE users');
      db!.exec('ALTER TABLE users_v2 RENAME TO users');
    });
    tx();
    console.log('[Database] Migrated users table to 5-role hierarchy schema (roles v2)');
  } catch (err) {
    console.error('[Database] Failed to migrate users table to roles v2:', err instanceof Error ? err.message : err);
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
}

function migrateDocumentsOrgUnit(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'org_unit_id')) {
    try {
      db.exec('ALTER TABLE documents ADD COLUMN org_unit_id INTEGER');
      console.log('[Database] Added documents.org_unit_id column');
    } catch (err) {
      console.warn('[Database] Failed to add documents.org_unit_id column:', err instanceof Error ? err.message : err);
    }
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_documents_org_unit ON documents(org_unit_id)');
  } catch (err) {
    console.warn('[Database] Failed to create idx_documents_org_unit index:', err instanceof Error ? err.message : err);
  }
}

// Ties each document to the archive year it was actually registered under
// (i.e. whatever generateArchiveRefNumber resolved current_archive_year to at
// create time), independent of the free-text `date` field the user enters
// (a letter's own date, which can be arbitrary/past). closeYear() uses this
// column — not `date` — to decide what belongs to a given archive year, so
// closing is deterministic and can't be fooled by an unrelated date value.
// Pre-existing rows never had this written at creation time, so they're
// backfilled from `date` (the same signal closeYear() used before this
// migration), preserving prior behavior for historical documents.
function migrateDocumentsArchiveYear(): void {
  if (!db || useMemoryFallback) return;
  const columns = db.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'archive_year')) {
    try {
      db.exec('ALTER TABLE documents ADD COLUMN archive_year INTEGER');
      console.log('[Database] Added documents.archive_year column');
    } catch (err) {
      console.warn('[Database] Failed to add documents.archive_year column:', err instanceof Error ? err.message : err);
    }
  }
  try {
    db.exec(`
      UPDATE documents
      SET archive_year = CAST(strftime('%Y', date) AS INTEGER)
      WHERE archive_year IS NULL AND date IS NOT NULL
    `);
  } catch (err) {
    console.warn('[Database] Failed to backfill documents.archive_year:', err instanceof Error ? err.message : err);
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_documents_archive_year ON documents(archive_year)');
  } catch (err) {
    console.warn('[Database] Failed to create idx_documents_archive_year index:', err instanceof Error ? err.message : err);
  }
}

function seedAdmin(): void {
  if (useMemoryFallback) {
    console.log('[Database] Fallback store already contains admin/admin123');
    return;
  }
  if (!db) return;

  const hash = bcrypt.hashSync('admin123', 10);

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as
    | { id: number }
    | undefined;

  if (!existing) {
    console.log('[Database] Seeding default admin user (admin / admin123)');
    db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, ?)"
    ).run('admin', hash, 'المدير العام', 'general_manager', 1);
    console.log('[Database] Default admin user created — change this password immediately');
    return;
  }

  // The default admin is seeded once on first run only. Never rewrite an
  // existing account: the GM's own password/role/status must persist.
  console.log('[Database] Admin user already exists — leaving it untouched');
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

export interface AuthUser {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  org_unit_id: number | null;
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
    return { success: true, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, org_unit_id: user.org_unit_id ?? null, is_active: user.is_active } };
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

    const row = db.prepare('SELECT id, username, password_hash, full_name, role, org_unit_id, is_active FROM users WHERE username = ?').get(username) as
      (AuthUser & { password_hash: string }) | undefined;

    if (!row) {
      // Run a bcrypt compare against a dummy hash anyway so "unknown user" and
      // "wrong password" take the same code path and don't form a timing oracle.
      bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
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
  role: 'general_manager' | 'deputy_manager' | 'dept_head' | 'section_head' | 'employee';
  org_unit_id?: number | null;
  is_active?: number;
}

export function getUsers(): AuthUser[] {
  if (useMemoryFallback) {
    return memoryStore.users.map(u => ({ ...u }));
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT id, username, full_name, role, org_unit_id, is_active, created_at, updated_at FROM users ORDER BY id').all() as AuthUser[];
}

export function getUserById(id: number): AuthUser | undefined {
  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.id === id);
    return user ? { ...user } : undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT id, username, full_name, role, org_unit_id, is_active, created_at, updated_at FROM users WHERE id = ?').get(id) as AuthUser | undefined;
}

export function getUserByUsername(username: string): AuthUser | undefined {
  if (useMemoryFallback) {
    const user = memoryStore.users.find(u => u.username === username);
    return user ? { ...user } : undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT id, username, full_name, role, org_unit_id, is_active, created_at, updated_at FROM users WHERE username = ?').get(username) as AuthUser | undefined;
}

export function createUser(input: UserInput): { success: boolean; id?: number; error?: string } {
  const { username, full_name, password, role, org_unit_id, is_active } = input;
  if (!username || !password || !role) {
    return { success: false, error: 'بيانات المستخدم غير مكتملة' };
  }
  if (password.length < 6) {
    return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
  }

  if (role === 'general_manager') {
    const gmExists = useMemoryFallback
      ? memoryStore.users.some(u => u.role === 'general_manager')
      : !!db?.prepare("SELECT id FROM users WHERE role = 'general_manager'").get();
    if (gmExists) {
      return { success: false, error: 'يوجد مدير عام واحد فقط في النظام' };
    }
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
      org_unit_id: org_unit_id ?? null,
      is_active: is_active ?? 1,
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return { success: true, id };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role, org_unit_id, is_active) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(username, hash, full_name ?? null, role, org_unit_id ?? null, is_active ?? 1);
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
    const oldUsername = user.username;
    if (input.username) user.username = input.username;
    if (input.full_name !== undefined) user.full_name = input.full_name ?? null;
    if (input.org_unit_id !== undefined) user.org_unit_id = input.org_unit_id ?? null;
    if (input.role) {
      if (id === actorId && input.role !== 'general_manager') return { success: false, error: 'لا يمكن خفض صلاحيات حسابك الخاص' };
      if (input.role === 'general_manager' && memoryStore.users.some(u => u.role === 'general_manager' && u.id !== id)) {
        return { success: false, error: 'يوجد مدير عام واحد فقط في النظام' };
      }
      user.role = input.role;
    }
    if (input.is_active !== undefined) {
      if (id === actorId && input.is_active !== 1) return { success: false, error: 'لا يمكن تعطيل حسابك الخاص' };
      user.is_active = input.is_active;
    }
    if (input.password) user.password_hash = bcrypt.hashSync(input.password, 10);
    user.updated_at = Date.now();
    if (input.username && input.username !== oldUsername) {
      for (const doc of memoryStore.documents) {
        if (doc.created_by === oldUsername) doc.created_by = input.username;
      }
    }
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const existing = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as { id: number; username: string; role: string } | undefined;
  if (!existing) return { success: false, error: 'المستخدم غير موجود' };

  const sets: string[] = [];
  const values: unknown[] = [];
  let newUsername: string | undefined;

  if (input.username !== undefined) {
    sets.push('username = ?');
    values.push(input.username);
    newUsername = input.username;
  }
  if (input.full_name !== undefined) {
    sets.push('full_name = ?');
    values.push(input.full_name ?? null);
  }
  if (input.org_unit_id !== undefined) {
    sets.push('org_unit_id = ?');
    values.push(input.org_unit_id ?? null);
  }
  if (input.password) {
    sets.push('password_hash = ?');
    values.push(bcrypt.hashSync(input.password, 10));
  }
  if (input.role) {
    if (id === actorId && input.role !== 'general_manager') {
      return { success: false, error: 'لا يمكن خفض صلاحيات حسابك الخاص' };
    }
    if (input.role === 'general_manager') {
      const gmExists = db.prepare("SELECT id FROM users WHERE role = 'general_manager' AND id != ?").get(id);
      if (gmExists) {
        return { success: false, error: 'يوجد مدير عام واحد فقط في النظام' };
      }
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
    const tx = db.transaction(() => {
      db!.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (newUsername !== undefined && newUsername !== existing.username) {
        db!.prepare('UPDATE documents SET created_by = ? WHERE created_by = ?').run(newUsername, existing.username);
      }
    });
    tx();
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
    if (memoryStore.users[idx].role === 'general_manager') {
      return { success: false, error: 'لا يمكن حذف حساب المدير العام' };
    }
    memoryStore.users.splice(idx, 1);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
  if (!user) return { success: false, error: 'المستخدم غير موجود' };

  if (user.role === 'general_manager') {
    return { success: false, error: 'لا يمكن حذف حساب المدير العام' };
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
// Organizational units (hierarchy)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgUnit {
  id: number;
  name: string;
  unit_type: 'administration' | 'section';
  parent_id: number | null;
  is_active: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface OrgUnitInput {
  name: string;
  unit_type: 'administration' | 'section';
  parent_id?: number | null;
  is_active?: number;
}

function findOrgUnit(id: number): OrgUnit | undefined {
  if (useMemoryFallback) {
    const unit = memoryStore.org_units.find(u => u.id === id);
    return unit ? { ...unit } : undefined;
  }
  if (!db) return undefined;
  return db.prepare('SELECT * FROM org_units WHERE id = ?').get(id) as OrgUnit | undefined;
}

function orgUnitNameConflict(name: string, parentId: number | null, excludeId?: number): boolean {
  if (useMemoryFallback) {
    return memoryStore.org_units.some(u => u.name === name && u.parent_id === parentId && u.id !== excludeId);
  }
  if (!db) return false;
  const row = parentId === null
    ? db.prepare('SELECT id FROM org_units WHERE name = ? AND parent_id IS NULL AND id != ?').get(name, excludeId ?? -1)
    : db.prepare('SELECT id FROM org_units WHERE name = ? AND parent_id = ? AND id != ?').get(name, parentId, excludeId ?? -1);
  return !!row;
}

export function getOrgUnits(activeOnly = false): OrgUnit[] {
  if (useMemoryFallback) {
    let units = memoryStore.org_units.map(u => ({ ...u }));
    if (activeOnly) units = units.filter(u => u.is_active === 1);
    return units;
  }
  if (!db) throw new Error('Database not initialized');
  const sql = activeOnly
    ? 'SELECT * FROM org_units WHERE is_active = 1 ORDER BY id'
    : 'SELECT * FROM org_units ORDER BY id';
  return db.prepare(sql).all() as OrgUnit[];
}

export function createOrgUnit(input: OrgUnitInput, createdBy?: number): { success: boolean; id?: number; error?: string } {
  const name = input.name?.trim();
  if (!name) return { success: false, error: 'اسم الوحدة مطلوب' };
  if (input.unit_type !== 'administration' && input.unit_type !== 'section') {
    return { success: false, error: 'نوع الوحدة غير صالح' };
  }

  let parentId: number | null = input.parent_id ?? null;

  if (input.unit_type === 'administration') {
    parentId = null;
  } else {
    if (!parentId) return { success: false, error: 'القسم يجب أن يتبع لوحدة رئيسية' };
    const parent = findOrgUnit(parentId);
    if (!parent) return { success: false, error: 'الوحدة الرئيسية غير موجودة' };
    if (parent.is_active !== 1) return { success: false, error: 'الوحدة الرئيسية غير نشطة' };
  }

  if (orgUnitNameConflict(name, parentId)) {
    return { success: false, error: 'توجد وحدة بنفس الاسم ضمن نفس الوحدة الرئيسية' };
  }

  if (useMemoryFallback) {
    const id = Math.max(0, ...memoryStore.org_units.map(u => u.id)) + 1;
    const now = Date.now();
    memoryStore.org_units.push({
      id,
      name,
      unit_type: input.unit_type,
      parent_id: parentId,
      is_active: input.is_active ?? 1,
      created_by: createdBy ?? null,
      created_at: now,
      updated_at: now
    });
    return { success: true, id };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const result = db.prepare(
      'INSERT INTO org_units (name, unit_type, parent_id, is_active, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(name, input.unit_type, parentId, input.is_active ?? 1, createdBy ?? null);
    return { success: true, id: Number(result.lastInsertRowid) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل إنشاء الوحدة' };
  }
}

export function updateOrgUnit(id: number, input: Partial<OrgUnitInput>): { success: boolean; error?: string } {
  const existing = findOrgUnit(id);
  if (!existing) return { success: false, error: 'الوحدة غير موجودة' };

  const unitType = input.unit_type ?? existing.unit_type;
  if (unitType !== 'administration' && unitType !== 'section') {
    return { success: false, error: 'نوع الوحدة غير صالح' };
  }

  let parentId: number | null = input.parent_id !== undefined ? input.parent_id : existing.parent_id;

  if (unitType === 'administration') {
    parentId = null;
  } else {
    if (!parentId) return { success: false, error: 'القسم يجب أن يتبع لوحدة رئيسية' };
    if (parentId === id) return { success: false, error: 'لا يمكن أن تكون الوحدة تابعة لنفسها' };
    const parent = findOrgUnit(parentId);
    if (!parent) return { success: false, error: 'الوحدة الرئيسية غير موجودة' };
    if (parent.is_active !== 1) return { success: false, error: 'الوحدة الرئيسية غير نشطة' };

    // Cycle check: walk ancestors of the new parent and make sure this unit isn't among them.
    let cursor: number | null = parentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (cursor === id) return { success: false, error: 'لا يمكن نقل الوحدة إلى أحد فروعها' };
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const cur = findOrgUnit(cursor);
      cursor = cur ? cur.parent_id : null;
    }
  }

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) return { success: false, error: 'اسم الوحدة مطلوب' };

  if (orgUnitNameConflict(name, parentId, id)) {
    return { success: false, error: 'توجد وحدة بنفس الاسم ضمن نفس الوحدة الرئيسية' };
  }

  if (useMemoryFallback) {
    const unit = memoryStore.org_units.find(u => u.id === id)!;
    unit.name = name;
    unit.unit_type = unitType;
    unit.parent_id = parentId;
    if (input.is_active !== undefined) unit.is_active = input.is_active;
    unit.updated_at = Date.now();
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const sets: string[] = ['name = ?', 'unit_type = ?', 'parent_id = ?'];
  const values: unknown[] = [name, unitType, parentId];
  if (input.is_active !== undefined) {
    sets.push('is_active = ?');
    values.push(input.is_active);
  }
  sets.push("updated_at = strftime('%s','now')");
  values.push(id);
  try {
    db.prepare(`UPDATE org_units SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل تحديث الوحدة' };
  }
}

export function deleteOrgUnit(id: number): { success: boolean; error?: string } {
  const existing = findOrgUnit(id);
  if (!existing) return { success: false, error: 'الوحدة غير موجودة' };

  if (useMemoryFallback) {
    if (memoryStore.org_units.some(u => u.parent_id === id)) {
      return { success: false, error: 'لا يمكن حذف الوحدة لوجود وحدات فرعية تابعة لها' };
    }
    if (memoryStore.users.some(u => u.org_unit_id === id)) {
      return { success: false, error: 'لا يمكن حذف الوحدة لوجود مستخدمين مرتبطين بها' };
    }
    if (memoryStore.documents.some(d => d.org_unit_id === id)) {
      return { success: false, error: 'لا يمكن حذف الوحدة لوجود وثائق مرتبطة بها' };
    }
    memoryStore.org_units = memoryStore.org_units.filter(u => u.id !== id);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const childCount = db.prepare('SELECT COUNT(*) as c FROM org_units WHERE parent_id = ?').get(id) as { c: number };
  if (childCount.c > 0) return { success: false, error: 'لا يمكن حذف الوحدة لوجود وحدات فرعية تابعة لها' };
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE org_unit_id = ?').get(id) as { c: number };
  if (userCount.c > 0) return { success: false, error: 'لا يمكن حذف الوحدة لوجود مستخدمين مرتبطين بها' };
  const docCount = db.prepare('SELECT COUNT(*) as c FROM documents WHERE org_unit_id = ?').get(id) as { c: number };
  if (docCount.c > 0) return { success: false, error: 'لا يمكن حذف الوحدة لوجود وثائق مرتبطة بها' };
  db.prepare('DELETE FROM org_units WHERE id = ?').run(id);
  return { success: true };
}

export function getOrgUnitSubtreeIds(rootId: number): number[] {
  if (useMemoryFallback) {
    const result: number[] = [];
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      result.push(cur);
      for (const unit of memoryStore.org_units) {
        if (unit.parent_id === cur) stack.push(unit.id);
      }
    }
    return result;
  }
  if (!db) throw new Error('Database not initialized');
  // Deliberately includes inactive units — documents in a deactivated section must not vanish from visibility.
  const rows = db.prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM org_units WHERE id = ?
      UNION ALL
      SELECT o.id FROM org_units o JOIN subtree s ON o.parent_id = s.id
    )
    SELECT id FROM subtree
  `).all(rootId) as Array<{ id: number }>;
  return rows.map(r => r.id);
}

export function isUserInSubtree(actorUnitId: number, targetUnitId: number | null): boolean {
  if (targetUnitId === null || targetUnitId === undefined) return false;
  return getOrgUnitSubtreeIds(actorUnitId).includes(targetUnitId);
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

function defaultFolderPermissionForRole(folderId: number, role: string): FolderPermission | null {
  // Role-tier fallback used when no explicit user_folder_permissions row exists.
  // Maps the new 5-role hierarchy onto the old admin/editor/viewer default tiers:
  //   general_manager, deputy_manager -> old 'admin' defaults (full access)
  //   dept_head, section_head         -> old 'editor' defaults (view only)
  //   employee                        -> old 'viewer' defaults (no implicit access)
  if (role === 'general_manager' || role === 'deputy_manager') {
    return { folder_id: folderId, can_view: 1, can_create: 1, can_edit: 1, can_delete: 1 };
  }
  if (role === 'dept_head' || role === 'section_head') {
    return { folder_id: folderId, can_view: 1, can_create: 0, can_edit: 0, can_delete: 0 };
  }
  return null;
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
    return defaultFolderPermissionForRole(folderId, role);
  }

  if (!db) throw new Error('Database not initialized');
  const perm = db.prepare('SELECT folder_id, can_view, can_create, can_edit, can_delete FROM user_folder_permissions WHERE user_id = ? AND folder_id = ?').get(userId, folderId) as FolderPermission | undefined;
  if (perm) return perm;

  return defaultFolderPermissionForRole(folderId, role);
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

export function clearAudit(): { success: boolean; error?: string } {
  try {
    if (useMemoryFallback) {
      memoryStore.audit_log = [];
      return { success: true };
    }
    if (!db) return { success: false, error: 'Database not initialized' };
    db.prepare('DELETE FROM audit_log').run();
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Yearly archive reference sequence
//
// Reference format: م.ب/{sequenceNumber}/{classificationNumber}
//   e.g. م.ب/1/105, م.ب/2/105, م.ب/3/150
//
// - sequenceNumber is read from the dedicated archive_sequences table (one row
//   per year) and incremented by 1 — never derived from COUNT(*) on documents,
//   so deleting a document can never free its number back up for reuse.
// - classificationNumber is the folder/classification id the document was
//   filed under.
// - Allocation runs inside a better-sqlite3 transaction. better-sqlite3 calls
//   are synchronous, so no other IPC handler can interleave mid-transaction;
//   combined with the UNIQUE(year) constraint and an upsert, two document:create
//   calls arriving back-to-back can never be handed the same sequence number.
// ─────────────────────────────────────────────────────────────────────────────

export interface ArchiveSequenceEntry {
  id: number;
  year: number;
  last_number: number;
  created_at: number;
  updated_at: number;
}

export function getArchiveSequence(year: number): ArchiveSequenceEntry | undefined {
  if (useMemoryFallback) {
    const entry = memoryStore.archive_sequences.find(s => s.year === year);
    return entry ? { ...entry } : undefined;
  }
  if (!db) throw new Error('Database not initialized');
  return db.prepare('SELECT * FROM archive_sequences WHERE year = ?').get(year) as ArchiveSequenceEntry | undefined;
}

function getNextArchiveSequenceNumber(year: number): number {
  if (useMemoryFallback) {
    let entry = memoryStore.archive_sequences.find(s => s.year === year);
    if (!entry) {
      entry = { id: memoryStore.archive_sequences.length + 1, year, last_number: 0, created_at: Date.now(), updated_at: Date.now() };
      memoryStore.archive_sequences.push(entry);
    }
    entry.last_number += 1;
    entry.updated_at = Date.now();
    return entry.last_number;
  }

  if (!db) throw new Error('Database not initialized');
  const allocate = db.transaction((y: number): number => {
    db!.prepare(`
      INSERT INTO archive_sequences (year, last_number, created_at, updated_at)
      VALUES (?, 1, strftime('%s','now'), strftime('%s','now'))
      ON CONFLICT(year) DO UPDATE SET
        last_number = last_number + 1,
        updated_at = strftime('%s','now')
    `).run(y);
    const row = db!.prepare('SELECT last_number FROM archive_sequences WHERE year = ?').get(y) as { last_number: number };
    return row.last_number;
  });
  return allocate(year);
}

// Archive year currently open for new documents. Independent of the OS clock
// so closeYear() can advance it the moment a year is closed, instead of new
// document numbering only resetting once the real calendar rolls over. Falls
// back to the OS calendar year when never explicitly set, so existing
// databases (no app_state row yet) keep behaving exactly as before.
export function getCurrentArchiveYear(): number {
  if (useMemoryFallback) {
    return memoryStore.current_archive_year ?? new Date().getFullYear();
  }
  if (!db) throw new Error('Database not initialized');
  const row = db.prepare('SELECT current_archive_year FROM app_state WHERE id = 1').get() as { current_archive_year: number | null } | undefined;
  return row?.current_archive_year ?? new Date().getFullYear();
}

function setCurrentArchiveYear(year: number): void {
  if (useMemoryFallback) {
    memoryStore.current_archive_year = year;
    return;
  }
  if (!db) throw new Error('Database not initialized');
  db.prepare(`
    INSERT INTO app_state (id, current_archive_year) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET current_archive_year = excluded.current_archive_year
  `).run(year);
}

// Backend-side gate: whether `year` has already gone through closeYear().
// Consulted before every ref-number allocation so document creation can
// never depend solely on a frontend-held "current year" value going stale —
// the archived_years table is the single source of truth.
function isArchiveYearClosed(year: number): boolean {
  if (useMemoryFallback) {
    return memoryStore.archived_years.some(y => y.year === year);
  }
  if (!db) throw new Error('Database not initialized');
  const row = db.prepare('SELECT 1 FROM archived_years WHERE year = ?').get(year);
  return !!row;
}

export function generateArchiveRefNumber(classificationNumber: number): { ref_number: string; sequence_number: number; year: number } {
  const year = getCurrentArchiveYear();
  if (isArchiveYearClosed(year)) {
    throw new Error(`السنة الأرشيفية ${year} مغلقة ولا يمكن تسجيل وثائق جديدة تحتها`);
  }
  const sequenceNumber = getNextArchiveSequenceNumber(year);
  return {
    ref_number: `م.ب/${sequenceNumber}/${classificationNumber}`,
    sequence_number: sequenceNumber,
    year
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Document barcode identifier
//
// The "م.ب/" prefix is a fixed, known part of every reference number, so it
// carries no information a scan needs — only the variable part after it
// (e.g. "58/1" out of "م.ب/58/1") is encoded into the barcode. This keeps
// the barcode payload plain ASCII, sidestepping Arabic/RTL/Unicode issues on
// scanners entirely (no FNC4 "Full ASCII" byte mode required, though the
// renderer in barcode.service.ts + code128-fnc4.ts still supports it for any
// legacy full-reference barcodes already printed). A scan resolves back to
// the complete reference number by re-adding the prefix — see
// document:getByBarcode in main.ts.
// ─────────────────────────────────────────────────────────────────────────────

export function generateDocumentBarcode(refNumber: string): string {
  return refNumber.replace(/^م\.ب\//, '');
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
      "INSERT INTO folders (name, group_name, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))"
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
// Security / per-user single-use verification codes
// ─────────────────────────────────────────────────────────────────────────────
// Replaces the old global system_verification_codes flow (left in place as dead
// data — see the CREATE TABLE above). Each code is minted for one target user,
// stored only as a bcrypt hash, valid 24h, single-use, and at most one active
// code per user (generating a new one revokes the prior active one).

export interface UserCodeEntry {
  id: number;
  user_id: number;
  username: string;
  full_name: string | null;
  status: 'active' | 'used' | 'revoked' | 'expired';
  generated_by: number | null;
  generated_by_name: string | null;
  generated_at: number;
  expires_at: number;
  used_at: number | null;
  used_document_id: number | null;
  revoked_by: number | null;
  revoked_at: number | null;
}

export function generateUserCode(targetUserId: number, issuedBy: number): { success: boolean; code?: string; expiresAt?: number; error?: string } {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const codeHash = bcrypt.hashSync(code, 10);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 86400;

  if (useMemoryFallback) {
    for (const c of memoryStore.user_verification_codes) {
      if (c.user_id === targetUserId && c.status === 'active') {
        c.status = 'revoked';
        c.revoked_by = issuedBy;
        c.revoked_at = now;
      }
    }
    memoryStore.user_verification_codes.push({
      id: memoryStore.user_verification_codes.length + 1,
      user_id: targetUserId,
      code_hash: codeHash,
      status: 'active',
      generated_by: issuedBy,
      generated_at: now,
      expires_at: expiresAt,
      used_at: null,
      used_document_id: null,
      revoked_by: null,
      revoked_at: null
    });
    return { success: true, code, expiresAt };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const tx = db.transaction(() => {
      db!.prepare(
        `UPDATE user_verification_codes SET status = 'revoked', revoked_by = ?, revoked_at = ? WHERE user_id = ? AND status = 'active'`
      ).run(issuedBy, now, targetUserId);
      db!.prepare(
        `INSERT INTO user_verification_codes (user_id, code_hash, status, generated_by, generated_at, expires_at) VALUES (?, ?, 'active', ?, ?, ?)`
      ).run(targetUserId, codeHash, issuedBy, now, expiresAt);
    });
    tx();
    return { success: true, code, expiresAt };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل توليد الرمز' };
  }
}

export function listUserCodes(): UserCodeEntry[] {
  const now = Math.floor(Date.now() / 1000);

  if (useMemoryFallback) {
    return memoryStore.user_verification_codes
      .slice()
      .sort((a, b) => b.generated_at - a.generated_at)
      .slice(0, 200)
      .map(c => {
        const targetUser = memoryStore.users.find(u => u.id === c.user_id);
        const generator = c.generated_by != null ? memoryStore.users.find(u => u.id === c.generated_by) : undefined;
        const status: UserCodeEntry['status'] = c.status === 'active' && c.expires_at <= now ? 'expired' : c.status;
        return {
          id: c.id,
          user_id: c.user_id,
          username: targetUser?.username ?? '',
          full_name: targetUser?.full_name ?? null,
          status,
          generated_by: c.generated_by,
          generated_by_name: generator?.full_name ?? generator?.username ?? null,
          generated_at: c.generated_at,
          expires_at: c.expires_at,
          used_at: c.used_at,
          used_document_id: c.used_document_id,
          revoked_by: c.revoked_by,
          revoked_at: c.revoked_at
        };
      });
  }

  if (!db) throw new Error('Database not initialized');
  const rows = db.prepare(`
    SELECT
      uvc.id, uvc.user_id, u.username, u.full_name,
      CASE WHEN uvc.status = 'active' AND uvc.expires_at <= ? THEN 'expired' ELSE uvc.status END as status,
      uvc.generated_by, gu.full_name as generated_by_full_name, gu.username as generated_by_username,
      uvc.generated_at, uvc.expires_at, uvc.used_at, uvc.used_document_id, uvc.revoked_by, uvc.revoked_at
    FROM user_verification_codes uvc
    JOIN users u ON u.id = uvc.user_id
    LEFT JOIN users gu ON gu.id = uvc.generated_by
    ORDER BY uvc.generated_at DESC
    LIMIT 200
  `).all(now) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: r.id as number,
    user_id: r.user_id as number,
    username: r.username as string,
    full_name: (r.full_name as string | null) ?? null,
    status: r.status as UserCodeEntry['status'],
    generated_by: (r.generated_by as number | null) ?? null,
    generated_by_name: (r.generated_by_full_name as string | null) ?? (r.generated_by_username as string | null) ?? null,
    generated_at: r.generated_at as number,
    expires_at: r.expires_at as number,
    used_at: (r.used_at as number | null) ?? null,
    used_document_id: (r.used_document_id as number | null) ?? null,
    revoked_by: (r.revoked_by as number | null) ?? null,
    revoked_at: (r.revoked_at as number | null) ?? null
  }));
}

export function revokeUserCode(codeId: number, revokedBy: number): { success: boolean; error?: string } {
  const now = Math.floor(Date.now() / 1000);

  if (useMemoryFallback) {
    const c = memoryStore.user_verification_codes.find(entry => entry.id === codeId);
    if (!c) return { success: false, error: 'الرمز غير موجود' };
    if (c.status !== 'active') return { success: false, error: 'الرمز غير نشط' };
    c.status = 'revoked';
    c.revoked_by = revokedBy;
    c.revoked_at = now;
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const result = db.prepare(
    `UPDATE user_verification_codes SET status = 'revoked', revoked_by = ?, revoked_at = ? WHERE id = ? AND status = 'active'`
  ).run(revokedBy, now, codeId);
  if (result.changes === 0) return { success: false, error: 'الرمز غير موجود أو غير نشط' };
  return { success: true };
}

export function verifyAndConsumeUserCode(userId: number, code: string, documentId?: number): { success: boolean; error?: string } {
  const now = Math.floor(Date.now() / 1000);
  const invalidError = 'الرمز غير صحيح أو منتهي الصلاحية';

  if (useMemoryFallback) {
    const c = memoryStore.user_verification_codes
      .filter(entry => entry.user_id === userId && entry.status === 'active' && entry.expires_at > now)
      .sort((a, b) => b.generated_at - a.generated_at)[0];
    if (!c || !bcrypt.compareSync(code, c.code_hash)) return { success: false, error: invalidError };
    c.status = 'used';
    c.used_at = now;
    c.used_document_id = documentId ?? null;
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const row = db.prepare(
    `SELECT id, code_hash FROM user_verification_codes WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY generated_at DESC LIMIT 1`
  ).get(userId, now) as { id: number; code_hash: string } | undefined;
  if (!row || !bcrypt.compareSync(code, row.code_hash)) return { success: false, error: invalidError };

  const tx = db.transaction(() => {
    return db!.prepare(
      `UPDATE user_verification_codes SET status = 'used', used_at = ?, used_document_id = ? WHERE id = ? AND status = 'active'`
    ).run(now, documentId ?? null, row.id);
  });
  const result = tx();
  if (result.changes === 0) return { success: false, error: invalidError };
  return { success: true };
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
// Master lists (message authors, preparers, senders, receivers, departments)
// ─────────────────────────────────────────────────────────────────────────────

export interface MasterListInput {
  list_type: string;
  name: string;
  name_en?: string | null;
  is_active?: number;
}

export interface MasterListEntry {
  id: number;
  list_type: string;
  name: string;
  name_en?: string | null;
  is_active: number;
  created_at: number;
}

export function getMasterLists(listType?: string, activeOnly = false): MasterListEntry[] {
  if (useMemoryFallback) {
    let list = memoryStore.master_lists.map(item => ({ ...item }));
    if (listType) list = list.filter(item => item.list_type === listType);
    if (activeOnly) list = list.filter(item => item.is_active === 1);
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }
  if (!db) throw new Error('Database not initialized');
  let sql = 'SELECT * FROM master_lists WHERE 1=1';
  const params: unknown[] = [];
  if (listType) {
    sql += ' AND list_type = ?';
    params.push(listType);
  }
  if (activeOnly) {
    sql += ' AND is_active = 1';
  }
  sql += ' ORDER BY name COLLATE NOCASE';
  return db.prepare(sql).all(...params) as MasterListEntry[];
}

export function createMasterList(input: MasterListInput): { success: boolean; id?: number; error?: string } {
  const { list_type, name, name_en, is_active } = input;
  if (!list_type || !name || !name.trim()) {
    return { success: false, error: 'نوع القائمة والاسم مطلوبان' };
  }

  if (useMemoryFallback) {
    const id = memoryStore.master_lists.length + 1;
    memoryStore.master_lists.push({
      id,
      list_type,
      name: name.trim(),
      name_en: name_en ?? null,
      is_active: is_active ?? 1,
      created_at: Date.now()
    });
    return { success: true, id };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  try {
    const result = db.prepare(
      'INSERT INTO master_lists (list_type, name, name_en, is_active) VALUES (?, ?, ?, ?)'
    ).run(list_type, name.trim(), name_en ?? null, is_active ?? 1);
    return { success: true, id: Number(result.lastInsertRowid) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل إضافة العنصر' };
  }
}

export function updateMasterList(id: number, input: Partial<MasterListInput>): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const item = memoryStore.master_lists.find(i => i.id === id);
    if (!item) return { success: false, error: 'العنصر غير موجود' };
    if (input.name !== undefined) item.name = input.name.trim();
    if (input.name_en !== undefined) item.name_en = input.name_en ?? null;
    if (input.is_active !== undefined) item.is_active = input.is_active;
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name.trim());
  }
  if (input.name_en !== undefined) {
    sets.push('name_en = ?');
    values.push(input.name_en ?? null);
  }
  if (input.is_active !== undefined) {
    sets.push('is_active = ?');
    values.push(input.is_active);
  }
  if (sets.length === 0) return { success: true };

  values.push(id);
  try {
    db.prepare(`UPDATE master_lists SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل تحديث العنصر' };
  }
}

export function deleteMasterList(id: number): { success: boolean; error?: string } {
  if (useMemoryFallback) {
    const idx = memoryStore.master_lists.findIndex(i => i.id === id);
    if (idx === -1) return { success: false, error: 'العنصر غير موجود' };
    memoryStore.master_lists.splice(idx, 1);
    return { success: true };
  }

  if (!db) return { success: false, error: 'قاعدة البيانات غير موجودة' };
  db.prepare('DELETE FROM master_lists WHERE id = ?').run(id);
  return { success: true };
}

export function toggleMasterListStatus(id: number, isActive: number): { success: boolean; error?: string } {
  return updateMasterList(id, { is_active: isActive });
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
    db!.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%s','now') WHERE id = ?").run(hash, req.user_id);
    db!.prepare(
      "UPDATE password_reset_requests SET status = ?, approved_by = ?, approved_at = strftime('%s','now'), new_password_hash = ? WHERE id = ?"
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
  db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%s','now') WHERE id = ?").run(hash, userId);
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
  db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%s','now') WHERE id = ?").run(hash, userId);
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
  // `year` is interpolated into the archived_documents_<year> table name below,
  // so it must be a plain integer — never a string from the renderer.
  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return { success: false, error: 'سنة غير صالحة' };
  }

  try {
    // A year can only ever be closed once — archived_years is the permanent
    // historical record, and re-running the close below would DELETE and
    // repopulate archived_documents_<year> from whatever is currently in
    // `documents`, destroying the batch archived the first time.
    const alreadyClosed = db.prepare('SELECT 1 FROM archived_years WHERE year = ?').get(year);
    if (alreadyClosed) {
      return { success: false, error: `سنة ${year} مغلقة بالفعل ولا يمكن إغلاقها مرة أخرى` };
    }

    const userData = app.getPath('userData');
    const backupDir = path.join(userData, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const dbPath = path.join(userData, 'archive.db');
    // archive_year (set at document:create time from the actual registration
    // year) — not the free-text `date` field — is what defines membership in
    // an archive year, so closing can't be thrown off by an unrelated date.
    const docCount = db.prepare('SELECT COUNT(*) as c FROM documents WHERE archive_year = ?').get(year) as { c: number };
    if (docCount.c === 0) {
      return { success: false, error: 'لا توجد وثائق لإغلاقها في هذه السنة' };
    }

    const backupPath = path.join(backupDir, `archive_${year}_${Date.now()}.db`);
    fs.copyFileSync(dbPath, backupPath);

    const tx = db.transaction(() => {
      db!.exec(`CREATE TABLE IF NOT EXISTS archived_documents_${year} AS SELECT * FROM documents WHERE 1=0`);
      db!.prepare(`DELETE FROM archived_documents_${year}`).run();
      db!.prepare(`INSERT INTO archived_documents_${year} SELECT * FROM documents WHERE archive_year = ?`).run(year);
      db!.prepare('DELETE FROM documents WHERE archive_year = ?').run(year);
      db!.prepare("DELETE FROM audit_log WHERE strftime('%Y', datetime(timestamp, 'unixepoch')) = ?").run(year.toString());
      db!.prepare('DELETE FROM counters').run();
      // Plain INSERT, not INSERT OR REPLACE: archived_years' PK is `year`, and
      // the already-closed check above should make a collision impossible —
      // if one still happens (e.g. a race), fail loudly instead of silently
      // overwriting a prior year's archived_at/document_count/backup_path.
      db!.prepare('INSERT INTO archived_years (year, archived_by, document_count, backup_path) VALUES (?, ?, ?, ?)')
        .run(year, adminId, docCount.c, backupPath);
      // Open the next archive year for new documents immediately — never
      // moves the current year backward, in case an older, previously
      // un-closed year is being closed retroactively.
      db!.prepare(`
        INSERT INTO app_state (id, current_archive_year) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET current_archive_year = MAX(current_archive_year, excluded.current_archive_year)
      `).run(year + 1);
    });
    tx();

    return { success: true, message: `تم إغلاق سنة ${year} بنجاح`, backupPath };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'فشل إغلاق السنة' };
  }
}

// Validates a year before it is ever interpolated into an `archived_documents_${year}`
// table name: must be an integer, and must be a year actually registered in
// archived_years (i.e. a table that closeYear() really created). This is the sole
// gate that keeps the table-name interpolation below from being an injection hole.
function assertArchivedYear(year: number): void {
  if (!Number.isInteger(year)) {
    throw new Error('سنة غير صالحة');
  }
  if (useMemoryFallback) {
    const exists = memoryStore.archived_years.some(y => y.year === year);
    if (!exists) throw new Error('لا يوجد أرشيف لهذه السنة');
    return;
  }
  if (!db) throw new Error('Database not initialized');
  const row = db.prepare('SELECT 1 FROM archived_years WHERE year = ?').get(year);
  if (!row) throw new Error('لا يوجد أرشيف لهذه السنة');
}

// List view: explicit column list excludes body/attachments_json/signature_base64
// (heavy + potentially sensitive fields). Pre-hierarchy year tables are frozen
// column snapshots taken before org_unit_id existed on documents, so we probe
// with PRAGMA table_info and substitute NULL when the column is absent.
export function getArchivedDocuments(year: number): unknown[] {
  assertArchivedYear(year);
  if (useMemoryFallback) {
    return [];
  }
  if (!db) throw new Error('Database not initialized');
  const columns = db.prepare(`PRAGMA table_info(archived_documents_${year})`).all() as Array<{ name: string }>;
  const orgUnitCol = columns.some(c => c.name === 'org_unit_id') ? 'd.org_unit_id' : 'NULL AS org_unit_id';
  return db.prepare(`
    SELECT
      d.id, d.ref_number, d.type_id, d.folder_id, d.confidentiality, d.subject, d.sender, d.receiver,
      d.message_author, d.address, d.target, d.content, d.input_method, d.date, d.notes, d.status,
      d.created_at, d.updated_at, d.created_by, ${orgUnitCol},
      dt.name as type, dt.label as type_label, dt.color as type_color, dt.icon as type_icon,
      CASE WHEN json_valid(d.attachments_json) THEN json_array_length(d.attachments_json) ELSE 0 END as attachments_count
    FROM archived_documents_${year} d
    LEFT JOIN document_types dt ON d.type_id = dt.id
    ORDER BY d.created_at DESC
  `).all();
}

// Detail view: full row (incl. body/attachments_json/signature_base64) — caller
// (main.ts handler) is responsible for applying the top-secret gate before this
// reaches the renderer.
export function getArchivedDocumentById(year: number, id: number): Record<string, unknown> | undefined {
  assertArchivedYear(year);
  if (useMemoryFallback) {
    return undefined;
  }
  if (!db) throw new Error('Database not initialized');
  const columns = db.prepare(`PRAGMA table_info(archived_documents_${year})`).all() as Array<{ name: string }>;
  const orgUnitSelect = columns.some(c => c.name === 'org_unit_id') ? '' : ', NULL AS org_unit_id';
  return db.prepare(`
    SELECT d.*, dt.name as type, dt.label as type_label, dt.color as type_color, dt.icon as type_icon,
      CASE WHEN json_valid(d.attachments_json) THEN json_array_length(d.attachments_json) ELSE 0 END as attachments_count${orgUnitSelect}
    FROM archived_documents_${year} d
    LEFT JOIN document_types dt ON d.type_id = dt.id
    WHERE d.id = ?
  `).get(id) as Record<string, unknown> | undefined;
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
      document_access_log: memoryStore.document_access_log,
      password_reset_requests: memoryStore.password_reset_requests,
      archived_years: memoryStore.archived_years,
      // Org-unit scoping is the authoritative authorization model (hierarchy
      // feature) — must round-trip through backup/restore or a replace-mode
      // import collapses every user/document to NULL org_unit_id, losing all
      // visibility scoping. memoryStore.users/documents already carry
      // org_unit_id as a plain field, so they need no extra handling here.
      org_units: memoryStore.org_units
    }, null, 2);
  }
  if (!db) throw new Error('Database not initialized');
  const folders = query('SELECT * FROM folders');
  const documents = query('SELECT * FROM documents');
  const document_types = query('SELECT * FROM document_types');
  const counters = query('SELECT * FROM counters');
  const audit_log = query('SELECT * FROM audit_log');
  const users = query('SELECT * FROM users');
  const document_access_log = query('SELECT * FROM document_access_log');
  const password_reset_requests = query('SELECT * FROM password_reset_requests');
  const archived_years = query('SELECT * FROM archived_years');
  const master_lists = query('SELECT * FROM master_lists');
  // Org-unit scoping is the authoritative authorization model (hierarchy
  // feature) — org_units itself, plus users.org_unit_id and
  // documents.org_unit_id (both already included via SELECT *), must all
  // round-trip through backup/restore or a replace-mode import collapses
  // every user/document to NULL org_unit_id, losing all visibility scoping.
  const org_units = query('SELECT * FROM org_units');

  return JSON.stringify({
    folders, documents, document_types, counters, audit_log, users,
    document_access_log, password_reset_requests, archived_years, master_lists,
    org_units
  }, null, 2);
}

export function importData(jsonData: string, mode: 'merge' | 'replace', callerRole?: string): { success: boolean; message: string } {
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
      master_lists?: Array<Record<string, unknown>>;
      org_units?: Array<Record<string, unknown>>;
    };

    // Replace-mode import deletes and re-inserts the users table wholesale —
    // without protection a deputy could overwrite the GM's password_hash/role
    // with attacker-controlled rows from a crafted backup file. Snapshot the
    // GM rows and re-assert them after the import unless the caller IS a GM.
    const protectGm = mode === 'replace' && callerRole !== 'general_manager';
    const gmRows = protectGm
      ? db.prepare("SELECT * FROM users WHERE role = 'general_manager'").all() as Array<Record<string, unknown>>
      : [];

    if (mode === 'replace') {
      db.exec(`
        DELETE FROM archived_years;
        DELETE FROM password_reset_requests;
        DELETE FROM document_access_log;
        DELETE FROM system_verification_codes;
        DELETE FROM audit_log;
        DELETE FROM documents;
        DELETE FROM counters;
        DELETE FROM master_lists;
        DELETE FROM document_types;
        DELETE FROM folders;
        DELETE FROM users;
        DELETE FROM org_units;
      `);
    }

    const insertFolder = db.prepare('INSERT OR REPLACE INTO folders (id, name, group_name, is_system, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertDocType = db.prepare('INSERT OR REPLACE INTO document_types (id, name, label, color, icon, prefix, is_active, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertOrgUnit = db.prepare('INSERT OR REPLACE INTO org_units (id, name, unit_type, parent_id, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents (
        id, ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, message_author, message_preparer, address, target, content, input_method,
        date, body, notes, status, barcode, signature_base64, attachments_json, created_at, updated_at, created_by, org_unit_id, archive_year
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCounter = db.prepare('INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)');
    const insertAudit = db.prepare('INSERT OR REPLACE INTO audit_log (id, action, doc_ref, details, username, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
    const insertUser = db.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, org_unit_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertMasterList = db.prepare('INSERT OR REPLACE INTO master_lists (id, list_type, name, name_en, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    // These three are part of the backup format (exportData) and must round-trip
    // through restore — otherwise replace-mode wipes access history, pending
    // password resets, and the record of closed years.
    const insertAccessLog = db.prepare('INSERT OR REPLACE INTO document_access_log (id, document_id, user_id, user_username, access_type, confidentiality_level, verification_method, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertResetRequest = db.prepare('INSERT OR REPLACE INTO password_reset_requests (id, user_id, username, request_date, status, approved_by, approved_at, new_password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertArchivedYear = db.prepare('INSERT OR REPLACE INTO archived_years (year, archived_at, archived_by, document_count, backup_path, notes) VALUES (?, ?, ?, ?, ?, ?)');

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
      // org_units must be inserted before documents/users so their
      // org_unit_id FK references resolve (best-effort — foreign_keys
      // enforcement is off, but this keeps insertion order sensible).
      // Tolerant of old backups that predate the hierarchy feature: absent
      // org_units array just means no rows to restore, not a throw.
      if (data.org_units) {
        for (const item of data.org_units) {
          insertOrgUnit.run(
            (item.id as number | undefined) ?? null,
            item.name,
            item.unit_type,
            (item.parent_id as number | undefined) ?? null,
            item.is_active ?? 1,
            (item.created_by as number | undefined) ?? null,
            item.created_at ?? new Date().toISOString(),
            item.updated_at ?? new Date().toISOString()
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
            item.message_author ?? item.author ?? null,
            item.message_preparer ?? item.writer_name ?? null,
            item.address ?? null,
            item.target ?? null,
            item.content ?? null,
            item.input_method ?? null,
            item.date,
            item.body ?? null,
            item.notes ?? null,
            item.status ?? 'قيد الاعتماد',
            item.barcode ?? null,
            item.signature_base64 ?? null,
            item.attachments_json ?? '[]',
            item.created_at ?? new Date().toISOString(),
            item.updated_at ?? new Date().toISOString(),
            item.created_by ?? null,
            (item.org_unit_id as number | undefined) ?? null,
            (item.archive_year as number | undefined) ?? null
          );
        }
      }
      if (data.counters) {
        for (const item of data.counters) {
          insertCounter.run(item.key, item.value);
        }
      }
      if (data.master_lists) {
        for (const item of data.master_lists) {
          // Pre-rename exports may still carry list_type 'author' — normalize it
          // so the CHECK constraint ('message_author', ...) doesn't reject the import.
          const listType = item.list_type === 'author' ? 'message_author' : item.list_type;
          insertMasterList.run(
            (item.id as number | undefined) ?? null,
            listType,
            item.name,
            item.name_en ?? null,
            item.is_active ?? 1,
            item.created_at ?? new Date().toISOString()
          );
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
            (item.org_unit_id as number | undefined) ?? null,
            item.is_active ?? 1,
            item.created_at ?? new Date().toISOString(),
            item.updated_at ?? new Date().toISOString()
          );
        }
      }
      if (data.document_access_log) {
        for (const item of data.document_access_log) {
          insertAccessLog.run(
            (item.id as number | undefined) ?? null,
            item.document_id,
            item.user_id,
            item.user_username,
            item.access_type,
            item.confidentiality_level,
            item.verification_method ?? null,
            (item.timestamp as number | undefined) ?? Math.floor(Date.now() / 1000)
          );
        }
      }
      if (data.password_reset_requests) {
        for (const item of data.password_reset_requests) {
          insertResetRequest.run(
            (item.id as number | undefined) ?? null,
            item.user_id,
            item.username,
            (item.request_date as number | undefined) ?? Math.floor(Date.now() / 1000),
            item.status ?? 'pending',
            (item.approved_by as number | undefined) ?? null,
            (item.approved_at as number | undefined) ?? null,
            item.new_password_hash ?? null
          );
        }
      }
      if (data.archived_years) {
        for (const item of data.archived_years) {
          insertArchivedYear.run(
            item.year,
            (item.archived_at as number | undefined) ?? Math.floor(Date.now() / 1000),
            (item.archived_by as number | undefined) ?? null,
            (item.document_count as number | undefined) ?? null,
            item.backup_path ?? null,
            item.notes ?? null
          );
        }
      }
    });

    tx();
    if (protectGm) {
      for (const gm of gmRows) {
        insertUser.run(
          gm.id, gm.username, gm.password_hash, gm.full_name ?? null, gm.role,
          (gm.org_unit_id as number | null | undefined) ?? null,
          gm.is_active ?? 1, gm.created_at ?? new Date().toISOString(), gm.updated_at ?? new Date().toISOString()
        );
      }
    }
    // Old backups predate archive_year in the export format — backfill it the
    // same way pre-migration rows are, so restored documents can still be
    // picked up by closeYear() later instead of staying archive_year = NULL.
    // Newer backups carry archive_year on each row and are unaffected.
    migrateDocumentsArchiveYear();
    return { success: true, message: 'تم استيراد البيانات بنجاح' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message };
  }
}
