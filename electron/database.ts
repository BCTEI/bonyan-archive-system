import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { app } from 'electron';

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

interface InMemoryStore {
  users: InMemoryUser[];
  folders: unknown[];
  documents: unknown[];
  counters: Record<string, number>;
  audit_log: unknown[];
  user_sessions: InMemorySession[];
  user_folder_permissions: InMemoryFolderPermission[];
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
  counters: {},
  audit_log: [],
  user_sessions: [],
  user_folder_permissions: []
};

let useMemoryFallback = false;

type DocumentType = 'صادر' | 'وارد' | 'مراسلات';

let db: Database.Database | null = null;
let initError: string | null = null;

export function initDb(): { success: boolean; error?: string } {
  console.log('[Database] initDb() called');

  // If already initialized successfully, return immediately
  if (db) {
    console.log('[Database] Database already initialized');
    return { success: true };
  }

  // If we already failed and chose the fallback, report it
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
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        created_by TEXT,
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

      CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
      CREATE INDEX IF NOT EXISTS idx_documents_ref ON documents(ref_number);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);
    console.log('[Database] Schema created/verified');

    seedFolders();
    migrateUsersTable();
    migrateRoles();
    seedAdmin();
    migrateDocumentsColumns();

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    console.error('[Database] Failed to initialize better-sqlite3:', message);
    initError = message;

    // Fallback: use in-memory store so the app does not hang
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
    const insert = db.prepare('INSERT INTO folders (id, name, group_name) VALUES (?, ?, ?)');
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
  // Back-fill updated_at for existing rows
  try {
    db!.exec("UPDATE users SET updated_at = COALESCE(updated_at, created_at, strftime('%s','now'))");
  } catch {
    // ignore
  }
}

function migrateRoles(): void {
  if (!db || useMemoryFallback) return;
  try {
    // Migrate legacy 'user' role to 'viewer'
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

  // Ensure the default admin account always uses admin123 so support can recover access.
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

  // Ensure default admin has a display name
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

const TYPE_PREFIX: Record<DocumentType, string> = {
  صادر: 'S',
  وارد: 'W',
  مراسلات: 'M',
};

export function getNextRef(type: DocumentType, folderId: number): string {
  if (useMemoryFallback) {
    const year = new Date().getFullYear();
    const key = `${type}_${folderId}_${year}`;
    const current = memoryStore.counters[key] ?? 0;
    memoryStore.counters[key] = current + 1;
    return `${TYPE_PREFIX[type]}-${String(folderId).padStart(3, '0')}-${year}-${String(current + 1).padStart(4, '0')}`;
  }
  if (!db) throw new Error('Database not initialized');
  const year = new Date().getFullYear();
  const key = `${type}_${folderId}_${year}`;

  db.prepare('INSERT OR IGNORE INTO counters (key, value) VALUES (?, 0)').run(key);
  db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);

  const row = db.prepare('SELECT value FROM counters WHERE key = ?').get(key) as { value: number };
  const prefix = TYPE_PREFIX[type] ?? 'X';
  return `${prefix}-${String(folderId).padStart(3, '0')}-${year}-${String(row.value).padStart(4, '0')}`;
}

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
    // Defaults by role
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
    return {
      total: memoryStore.documents.length,
      صادر: memoryStore.documents.filter((d: any) => d.type === 'صادر').length,
      وارد: memoryStore.documents.filter((d: any) => d.type === 'وارد').length,
      مراسلات: memoryStore.documents.filter((d: any) => d.type === 'مراسلات').length,
    };
  }
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
  if (useMemoryFallback) {
    return JSON.stringify({
      folders: memoryStore.folders,
      documents: memoryStore.documents,
      counters: memoryStore.counters,
      audit_log: memoryStore.audit_log,
      users: memoryStore.users
    }, null, 2);
  }
  if (!db) throw new Error('Database not initialized');
  const folders = query('SELECT * FROM folders');
  const documents = query('SELECT * FROM documents');
  const counters = query('SELECT * FROM counters');
  const audit_log = query('SELECT * FROM audit_log');
  const users = query('SELECT * FROM users');

  return JSON.stringify({ folders, documents, counters, audit_log, users }, null, 2);
}

export function importData(jsonData: string, mode: 'merge' | 'replace'): { success: boolean; message: string } {
  if (useMemoryFallback) {
    return { success: false, message: 'الاستيراد غير مدعوم في وضع الذاكرة المؤقت' };
  }
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
