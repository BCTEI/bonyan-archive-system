import { app, BrowserWindow, ipcMain, Menu, protocol, shell, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';

// Register a custom 'app' protocol so Angular HashLocationStrategy never has to
// rewrite a file:// URL (which causes ERR_FILE_NOT_FOUND in packaged builds).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const APP_PROTOCOL = 'app';
const APP_HOST = '-';
const browserDir = path.join(__dirname, '../bonyan-archive-system/browser');

function mimeTypeForExt(ext: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

function resolveBrowserFile(urlPath: string): string {
  let cleanPath = urlPath;
  if (cleanPath.startsWith(`/${APP_HOST}`)) {
    cleanPath = cleanPath.slice(APP_HOST.length + 1) || '/';
  }

  let filePath = path.join(browserDir, decodeURIComponent(cleanPath));
  if (filePath.endsWith(path.sep)) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!ext || ext === '.html') {
    return path.join(browserDir, 'index.html');
  }

  return filePath;
}

function registerAppProtocol(): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const filePath = resolveBrowserFile(url.pathname);
    try {
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: { 'Content-Type': mimeTypeForExt(path.extname(filePath)) }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not found';
      return new Response(message, { status: 404, statusText: 'Not Found' });
    }
  });
  console.log('[Main] Registered app:// protocol');
}

function appUrl(hash: string): string {
  return `${APP_PROTOCOL}://${APP_HOST}/index.html#${hash}`;
}

import {
  initDb,
  query,
  run,
  getNextRef,
  addAudit,
  clearAudit,
  exportData,
  importData,
  authenticateUser,
  getInitError,
  getUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  toggleUserStatus,
  addSession,
  getSessions,
  getTodaySessions,
  getFolderPermission,
  getUserFolderPermissions,
  setFolderPermissions,
  getDocumentTypes,
  getDocumentTypeById,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  getFolders,
  getFolderGroups,
  getFolderById,
  createFolder,
  updateFolder,
  deleteFolder,
  generateUserCode,
  listUserCodes,
  revokeUserCode,
  verifyAndConsumeUserCode,
  logDocumentAccess,
  requestPasswordReset,
  getPendingPasswordResetRequests,
  approvePasswordReset,
  rejectPasswordReset,
  adminResetPassword,
  changeOwnPassword,
  getArchivedYears,
  closeYear,
  getArchivedDocuments,
  getArchivedDocumentById,
  getMasterLists,
  createMasterList,
  updateMasterList,
  deleteMasterList,
  toggleMasterListStatus,
  getOrgUnits,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  getOrgUnitSubtreeIds,
  isUserInSubtree,
  AuthUser,
  FolderPermission,
  DocumentTypeInput,
  FolderInput,
  OrgUnit,
  OrgUnitInput,
} from './database';

let loginWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let currentUser: AuthUser | null = null;

type Role = 'employee' | 'section_head' | 'dept_head' | 'deputy_manager' | 'general_manager';

const ROLE_LEVEL: Record<string, number> = {
  employee: 1, section_head: 2, dept_head: 3, deputy_manager: 4, general_manager: 5
};

function hasMinRole(user: AuthUser | null, min: Role): boolean {
  return !!user && (ROLE_LEVEL[user.role] ?? 0) >= ROLE_LEVEL[min];
}

function activeUser(): AuthUser | null {
  if (!currentUser) return null;
  try {
    const fresh = getUserById(currentUser.id);
    if (fresh && fresh.is_active !== 1) {
      // Deactivated mid-session: same session-teardown as auth:logout — drop any
      // top-secret unlocks and this user's rate-limit state so they can't leak
      // into whoever logs in next in this process.
      verifiedTopSecret.clear();
      clearRateLimit(currentUser.id);
      currentUser = null;
      return null;
    }
  } catch {
    // ignore in fallback/memory mode
  }
  return currentUser;
}

// GM protection + password authority ────────────────────────────────────────

function canAdministerUser(actor: AuthUser, target: AuthUser): boolean {
  if (actor.role === 'general_manager') return true;
  if (actor.role === 'deputy_manager') return target.role !== 'general_manager';
  return false;
}

function canResetPasswordOf(actor: AuthUser, target: AuthUser): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'general_manager') return true;
  if (actor.role === 'deputy_manager') return target.role !== 'general_manager';
  if (actor.role === 'dept_head' || actor.role === 'section_head') {
    if ((ROLE_LEVEL[target.role] ?? 0) >= ROLE_LEVEL[actor.role]) return false;
    return actor.org_unit_id != null && isUserInSubtree(actor.org_unit_id, target.org_unit_id);
  }
  return false;
}

// Ruled exception: a GM cannot be "administered" (canAdministerUser/canResetPasswordOf
// keep blocking user:update/delete/toggleStatus and passwordReset:adminReset targeting
// the GM), but the GM must still be able to use the ordinary self-service reset flow
// (passwordReset:request, from the login screen) like anyone else, and deputy_manager+
// must be able to approve that specific request. Every row returned by
// getPendingPasswordResetRequests() originates from passwordReset:request, so no extra
// "came from the request channel" check is needed beyond reading the pending row itself.
function canApprovePasswordResetRequest(actor: AuthUser, target: AuthUser): boolean {
  if (target.role === 'general_manager') return hasMinRole(actor, 'deputy_manager');
  return canResetPasswordOf(actor, target);
}

// Document visibility scope ──────────────────────────────────────────────────

function documentScope(user: AuthUser): { where: string; params: unknown[] } {
  if (ROLE_LEVEL[user.role] >= ROLE_LEVEL['deputy_manager']) return { where: '', params: [] };
  if (user.role === 'dept_head' || user.role === 'section_head') {
    const ids = user.org_unit_id != null ? getOrgUnitSubtreeIds(user.org_unit_id) : [];
    const inClause = ids.length ? `d.org_unit_id IN (${ids.map(() => '?').join(',')}) OR ` : '';
    return { where: `(${inClause}d.created_by = ?)`, params: [...ids, user.username] };
  }
  return { where: 'd.created_by = ?', params: [user.username] };
}

function canTouchDocument(user: AuthUser, doc: { org_unit_id?: number | null; created_by?: string | null }): boolean {
  if (ROLE_LEVEL[user.role] >= ROLE_LEVEL['deputy_manager']) return true;
  if (doc.created_by != null && doc.created_by === user.username) return true;
  if (user.role === 'dept_head' || user.role === 'section_head') {
    return user.org_unit_id != null && doc.org_unit_id != null && isUserInSubtree(user.org_unit_id, doc.org_unit_id);
  }
  return false;
}

// Confidentiality matrix ─────────────────────────────────────────────────────

function canAccessConfidentiality(user: AuthUser, conf: string, docCreatedBy?: string): boolean {
  if (conf === 'عادي') return true;
  if (docCreatedBy && docCreatedBy === user.username) return true;
  if (conf === 'سري') return ROLE_LEVEL[user.role] >= ROLE_LEVEL['section_head'];
  if (conf === 'سري للغاية') return ROLE_LEVEL[user.role] >= ROLE_LEVEL['dept_head'];
  return false;
}

// Main-process confidentiality gate ──────────────────────────────────────────
// Documents/scopes the active session has unlocked with a single-use code or
// password re-verification this session. Keys look like 'live:<docId>' or
// 'archive:<year>:<docId>'. Cleared wholesale on auth:logout.
const verifiedTopSecret = new Set<string>();

// Per-user in-memory rate limiter for security:verifyCode — 5 failures within a
// 15-minute window locks that user out of further attempts for 15 minutes.
interface CodeAttemptState {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number | null;
}
const codeAttempts = new Map<number, CodeAttemptState>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_LOCK_MS = 15 * 60 * 1000;

function checkRateLimit(userId: number): { locked: boolean; message?: string } {
  const entry = codeAttempts.get(userId);
  if (!entry) return { locked: false };
  const now = Date.now();
  if (entry.lockedUntil != null) {
    if (entry.lockedUntil > now) {
      const minutesLeft = Math.max(1, Math.ceil((entry.lockedUntil - now) / 60000));
      return { locked: true, message: `تم تأمين التحقق مؤقتاً، حاول بعد ${minutesLeft} دقائق` };
    }
    codeAttempts.delete(userId);
  }
  return { locked: false };
}

function recordFailedCodeAttempt(userId: number): void {
  const now = Date.now();
  let entry = codeAttempts.get(userId);
  if (!entry || now - entry.firstFailureAt > RATE_LIMIT_WINDOW_MS) {
    entry = { failures: 0, firstFailureAt: now, lockedUntil: null };
  }
  entry.failures += 1;
  if (entry.failures >= RATE_LIMIT_MAX_FAILURES) {
    entry.lockedUntil = now + RATE_LIMIT_LOCK_MS;
  }
  codeAttempts.set(userId, entry);
}

function clearRateLimit(userId: number): void {
  codeAttempts.delete(userId);
}

function createLoginWindow(): void {
  console.log('[Main] Creating login window');
  loginWindow = new BrowserWindow({
    width: 450,
    height: 650,
    frame: false,
    center: true,
    resizable: false,
    movable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loginWindow.loadURL(appUrl('login'));
  loginWindow.on('closed', () => {
    loginWindow = null;
    if (!mainWindow) app.quit();
  });
}

function createMainWindow(): void {
  console.log('[Main] Creating main window');
  mainWindow = new BrowserWindow({
    minWidth: 1024,
    minHeight: 768,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const mainUrl = appUrl('/main/dashboard');
  console.log('[Main] Loading main window URL:', mainUrl);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Main] Main window failed to load:', errorCode, errorDescription);
  });

  mainWindow.loadURL(mainUrl);
  mainWindow.maximize();
  mainWindow.show();

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Window closed without going through auth:logout (e.g. Alt+F4, OS close):
    // still tear down the session's top-secret unlocks + rate-limit state.
    if (currentUser) {
      verifiedTopSecret.clear();
      clearRateLimit(currentUser.id);
    }
    currentUser = null;
  });
}

// Register IPC handlers BEFORE app ready
console.log('[Main] Registering IPC handlers');

ipcMain.handle('db:init', () => {
  console.log('[Main] Handling db:init');
  return initDb();
});

ipcMain.handle('db:query', (_event: IpcMainInvokeEvent, sql: string, params?: unknown[]) => {
  console.log('[Main] Handling db:query');
  const user = activeUser();
  if (!user) throw new Error('يجب تسجيل الدخول');
  if (!hasMinRole(user, 'deputy_manager')) throw new Error('ليس لديك صلاحية');
  return query(sql, params);
});

ipcMain.handle('db:run', (_event: IpcMainInvokeEvent, sql: string, params?: unknown[]) => {
  console.log('[Main] Handling db:run');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية التعديل' };
  return run(sql, params);
});

ipcMain.handle('db:getNextRef', (_event: IpcMainInvokeEvent, typeId: number, folderId: number) => {
  console.log('[Main] Handling db:getNextRef');
  const user = activeUser();
  if (!user) throw new Error('يجب تسجيل الدخول');
  return getNextRef(typeId, folderId);
});

ipcMain.handle('db:export', () => {
  console.log('[Main] Handling db:export');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية التصدير' };
  return exportData();
});

ipcMain.handle('db:import', (_event: IpcMainInvokeEvent, jsonData: string, mode: 'merge' | 'replace') => {
  console.log('[Main] Handling db:import');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية الاستيراد' };
  addAudit('استيراد بيانات', undefined, `الوضع: ${mode}`, user.username);
  return importData(jsonData, mode);
});

ipcMain.handle('db:audit', (_event: IpcMainInvokeEvent, action: string, docRef?: string, details?: string) => {
  console.log('[Main] Handling db:audit');
  addAudit(action, docRef, details, currentUser?.username);
  return true;
});

ipcMain.handle('audit:clearAll', () => {
  console.log('[Main] Handling audit:clearAll');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
  return clearAudit();
});

ipcMain.handle('audit:addEntry', (_event: IpcMainInvokeEvent, entry: { action: string; doc_ref?: string; details?: string; username?: string }) => {
  console.log('[Main] Handling audit:addEntry');
  try {
    addAudit(entry.action, entry.doc_ref, entry.details, entry.username ?? currentUser?.username);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('audit:list', (_event: IpcMainInvokeEvent, limit?: number) => {
  console.log('[Main] Handling audit:list');
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'section_head')) return { success: false, error: 'ليس لديك صلاحية عرض سجل التدقيق' };
    const sql = limit
      ? 'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM audit_log ORDER BY timestamp DESC';
    const entries = query(sql, limit ? [limit] : undefined);
    return { success: true, entries };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// Dashboard stats scoped to the caller's document visibility (documentScope) and
// confidentiality clearance (canAccessConfidentiality) — replaces the old unscoped
// `db:stats` handler, which called database.ts's global getStats() and was never
// wired through preload/d.ts (dead code, unreachable from the renderer).
ipcMain.handle('db:stats', () => {
  console.log('[Main] Handling db:stats');
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    const scope = documentScope(user);
    let sql = 'SELECT d.type_id, d.confidentiality, d.created_by FROM documents d';
    if (scope.where) sql += ' WHERE ' + scope.where;
    const rows = query(sql, scope.params) as Array<{ type_id: number; confidentiality: string; created_by: string | null }>;
    const stats: Record<string, number> = { total: 0 };
    for (const row of rows) {
      if (!canAccessConfidentiality(user, row.confidentiality, row.created_by ?? undefined)) continue;
      const typeKey = `type_${row.type_id}`;
      stats[typeKey] = (stats[typeKey] ?? 0) + 1;
      stats[row.confidentiality] = (stats[row.confidentiality] ?? 0) + 1;
      stats.total += 1;
    }
    return { success: true, stats };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// Folder document counts scoped to the caller's document visibility (documentScope).
ipcMain.handle('folder:getAllWithCounts', () => {
  console.log('[Main] Handling folder:getAllWithCounts');
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    const folders = getFolders(true);
    const scope = documentScope(user);
    let sql = 'SELECT d.folder_id, COUNT(*) as c FROM documents d';
    if (scope.where) sql += ' WHERE ' + scope.where;
    sql += ' GROUP BY d.folder_id';
    const counts = query(sql, scope.params) as Array<{ folder_id: number; c: number }>;
    const map = new Map(counts.map(c => [c.folder_id, c.c]));
    const withCounts = folders.map(f => ({ ...f, document_count: map.get(f.id) ?? 0 }));
    return { success: true, folders: withCounts };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('db:getDbPath', () => {
  console.log('[Main] Handling db:getDbPath');
  try {
    return { success: true, path: path.join(app.getPath('userData'), 'archive.db') };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('db:status', () => {
  console.log('[Main] Handling db:status');
  const initErr = getInitError();
  return {
    success: true,
    fallback: !!initErr,
    error: initErr ?? null
  };
});

ipcMain.handle('auth:login', (_event: IpcMainInvokeEvent, username: string, password: string) => {
  console.log('[Main] Handling auth:login for:', username);
  try {
    const initResult = initDb();
    if (!initResult.success) {
      console.error('[Main] DB init failed:', initResult.error);
      return { success: false, error: initResult.error ?? 'فشل تهيئة قاعدة البيانات' };
    }

    const initErr = getInitError();
    if (initErr && !initResult.error) {
      console.warn('[Main] DB fallback active:', initErr);
    }

    const result = authenticateUser(username, password);
    if (result.success && result.user) {
      // New session starting: verifiedTopSecret is process-global, so it must be
      // cleared here too (not just on auth:logout) or a prior user's unlocked
      // top-secret docs would remain unlocked for whoever logs in next in this
      // same process. Also drop any leftover rate-limit state for whichever user
      // was previously signed in (covers logout-less session handoffs).
      if (currentUser) clearRateLimit(currentUser.id);
      verifiedTopSecret.clear();
      currentUser = result.user;
      addSession(currentUser.id, currentUser.username, 'login');
      addAudit('تسجيل دخول', undefined, undefined, currentUser.username);
      console.log('[Main] Returning success=true');
      createMainWindow();
      if (loginWindow) loginWindow.close();
      return { success: true, user: currentUser };
    }

    console.log('[Main] Returning error:', result.error);
    return { success: false, error: result.error ?? 'فشل تسجيل الدخول' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown IPC error';
    console.error('[Main] auth:login exception:', message);
    return { success: false, error: 'خطأ في الاتصال بالنظام' };
  }
});

ipcMain.handle('auth:getCurrentUser', () => {
  console.log('[Main] Handling auth:getCurrentUser');
  return activeUser();
});

ipcMain.handle('auth:logout', () => {
  console.log('[Main] Handling auth:logout');
  if (currentUser) {
    addSession(currentUser.id, currentUser.username, 'logout');
    addAudit('تسجيل خروج', undefined, undefined, currentUser.username);
    clearRateLimit(currentUser.id);
  }
  verifiedTopSecret.clear();
  currentUser = null;
  createLoginWindow();
  if (mainWindow) mainWindow.close();
  return true;
});

ipcMain.handle('auth:verifyPassword', (_event: IpcMainInvokeEvent, username: string, password: string) => {
  console.log('[Main] Handling auth:verifyPassword for:', username);
  try {
    const user = activeUser();
    if (!user) return false;
    if (username !== user.username) return false;
    initDb();
    const result = authenticateUser(username, password);
    return result.success;
  } catch (err: unknown) {
    console.error('[Main] auth:verifyPassword exception:', err instanceof Error ? err.message : err);
    return false;
  }
});

ipcMain.handle('user:getAll', () => {
  console.log('[Main] Handling user:getAll');
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    return { success: true, users: getUsers() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:getById', (_event: IpcMainInvokeEvent, id: number) => {
  console.log('[Main] Handling user:getById', id);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const found = getUserById(id);
    return { success: !!found, user: found };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:create', (_event: IpcMainInvokeEvent, data: unknown) => {
  console.log('[Main] Handling user:create');
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const result = createUser(data as Parameters<typeof createUser>[0]);
    if (result.success) {
      addAudit('إنشاء مستخدم جديد', undefined, `اسم المستخدم: ${(data as any).username}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:update', (_event: IpcMainInvokeEvent, id: number, data: unknown) => {
  console.log('[Main] Handling user:update', id);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const target = getUserById(id);
    if (!target || !canAdministerUser(user!, target)) {
      return { success: false, error: target ? 'لا يمكن تعديل حساب المدير العام' : 'المستخدم غير موجود' };
    }
    const result = updateUser(id, data as Parameters<typeof updateUser>[1], user?.id);
    if (result.success) {
      addAudit('تعديل مستخدم', undefined, `اسم المستخدم: ${(data as any).username ?? id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:delete', (_event: IpcMainInvokeEvent, id: number) => {
  console.log('[Main] Handling user:delete', id);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const target = getUserById(id);
    if (!target || !canAdministerUser(user!, target)) {
      return { success: false, error: target ? 'لا يمكن تعديل حساب المدير العام' : 'المستخدم غير موجود' };
    }
    const result = deleteUser(id, user?.id);
    if (result.success && target) {
      addAudit('حذف مستخدم', undefined, `اسم المستخدم: ${target.username}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:toggleStatus', (_event: IpcMainInvokeEvent, id: number, isActive: number) => {
  console.log('[Main] Handling user:toggleStatus', id, isActive);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const target = getUserById(id);
    if (!target || !canAdministerUser(user!, target)) {
      return { success: false, error: target ? 'لا يمكن تعديل حساب المدير العام' : 'المستخدم غير موجود' };
    }
    const result = toggleUserStatus(id, isActive, user?.id);
    if (result.success && target) {
      addAudit('تغيير حالة المستخدم', undefined, `اسم المستخدم: ${target.username} - ${isActive ? 'نشط' : 'معطل'}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:getSessions', (_event: IpcMainInvokeEvent, userId?: number) => {
  console.log('[Main] Handling user:getSessions', userId);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager') && userId !== user?.id) {
      return { success: false, error: 'ليس لديك صلاحية عرض السجل' };
    }
    return { success: true, sessions: getSessions(userId) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:getTodaySessions', () => {
  console.log('[Main] Handling user:getTodaySessions');
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, sessions: getTodaySessions() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:getFolderPermissions', (_event: IpcMainInvokeEvent, userId: number) => {
  console.log('[Main] Handling user:getFolderPermissions', userId);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager') && userId !== user?.id) {
      return { success: false, error: 'ليس لديك صلاحية عرض الصلاحيات' };
    }
    return { success: true, permissions: getUserFolderPermissions(userId) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:getFolderPermission', (_event: IpcMainInvokeEvent, userId: number, folderId: number) => {
  console.log('[Main] Handling user:getFolderPermission', userId, folderId);
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    if (user.id !== userId && !hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية' };
    }
    const target = getUserById(userId);
    const perm = getFolderPermission(userId, folderId, target?.role ?? 'employee');
    return { success: true, permission: perm };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

ipcMain.handle('user:setFolderPermissions', (_event: IpcMainInvokeEvent, userId: number, permissions: FolderPermission[]) => {
  console.log('[Main] Handling user:setFolderPermissions', userId);
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) {
      return { success: false, error: 'ليس لديك صلاحية إدارة الصلاحيات' };
    }
    setFolderPermissions(userId, permissions);
    const target = getUserById(userId);
    addAudit('تغيير صلاحيات مجلدات المستخدم', undefined, `المستخدم: ${target?.username ?? userId}`, user?.username);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Document type handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('documentType:getAll', (_event: IpcMainInvokeEvent, activeOnly = false) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, types: getDocumentTypes(activeOnly) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('documentType:getById', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, type: getDocumentTypeById(id) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('documentType:create', (_event: IpcMainInvokeEvent, data: DocumentTypeInput) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = createDocumentType(data);
    if (result.success) {
      addAudit('إنشاء نوع وثيقة', undefined, `الاسم: ${data.label}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('documentType:update', (_event: IpcMainInvokeEvent, id: number, data: Partial<DocumentTypeInput>) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = updateDocumentType(id, data);
    if (result.success) {
      addAudit('تعديل نوع وثيقة', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('documentType:delete', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = deleteDocumentType(id);
    if (result.success) {
      addAudit('حذف نوع وثيقة', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Master list handlers (authors, senders, receivers, departments)
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('masterList:getAll', (_event: IpcMainInvokeEvent, listType?: string, activeOnly = false) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, items: getMasterLists(listType, activeOnly) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('masterList:create', (_event: IpcMainInvokeEvent, data: Parameters<typeof createMasterList>[0]) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = createMasterList(data);
    if (result.success) {
      addAudit('إضافة قائمة رئيسية', undefined, `${data.list_type}: ${data.name}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('masterList:update', (_event: IpcMainInvokeEvent, id: number, data: Parameters<typeof updateMasterList>[1]) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = updateMasterList(id, data);
    if (result.success) {
      addAudit('تعديل قائمة رئيسية', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('masterList:delete', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = deleteMasterList(id);
    if (result.success) {
      addAudit('حذف قائمة رئيسية', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('masterList:toggleStatus', (_event: IpcMainInvokeEvent, id: number, isActive: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = toggleMasterListStatus(id, isActive);
    if (result.success) {
      addAudit('تغيير حالة قائمة رئيسية', undefined, `المعرف: ${id} - ${isActive ? 'نشط' : 'معطل'}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Folder category handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('folderCategory:getAll', (_event: IpcMainInvokeEvent, activeOnly = false) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, folders: getFolders(activeOnly) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('folderCategory:getGroups', () => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, groups: getFolderGroups() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('folderCategory:getById', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, folder: getFolderById(id) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('folderCategory:create', (_event: IpcMainInvokeEvent, data: FolderInput) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = createFolder(data, user?.id);
    if (result.success) {
      addAudit('إنشاء تصنيف', undefined, `الاسم: ${data.name}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('folderCategory:update', (_event: IpcMainInvokeEvent, id: number, data: Partial<FolderInput>) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = updateFolder(id, data);
    if (result.success) {
      addAudit('تعديل تصنيف', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('folderCategory:delete', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = deleteFolder(id);
    if (result.success) {
      addAudit('حذف تصنيف', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Document handlers with confidentiality enforcement
// ─────────────────────────────────────────────────────────────────────────────

// Strips the heavy/sensitive fields of a top-secret (سري للغاية) row and marks
// it locked, unless this session already unlocked it via code/password verify
// (verifiedTopSecret). Mutates and returns the row for convenience.
function applyTopSecretGate(doc: Record<string, unknown>, scopeKey: string): Record<string, unknown> {
  if (doc.confidentiality === 'سري للغاية' && !verifiedTopSecret.has(scopeKey)) {
    doc.body = '';
    doc.attachments_json = '[]';
    doc.signature_base64 = null;
    doc.locked = true;
  }
  return doc;
}

// json_valid guard: a NULL/'' /malformed attachments_json (legacy rows, partial
// writes) must not make json_array_length throw "malformed JSON" for the whole
// query — fall back to 0 instead.
const DOCUMENT_SELECT_COLUMNS =
  "d.*, dt.name as type, dt.label as type_label, dt.color as type_color, dt.icon as type_icon, " +
  "CASE WHEN json_valid(d.attachments_json) THEN json_array_length(d.attachments_json) ELSE 0 END as attachments_count";

ipcMain.handle('document:getAll', () => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    const scope = documentScope(user);
    let sql = `SELECT ${DOCUMENT_SELECT_COLUMNS} FROM documents d JOIN document_types dt ON d.type_id = dt.id`;
    if (scope.where) sql += ' WHERE ' + scope.where;
    sql += ' ORDER BY d.created_at DESC';
    const docs = query(sql, scope.params) as Array<Record<string, unknown>>;
    const visible = docs.filter(d => canAccessConfidentiality(user, d.confidentiality as string, (d.created_by as string) ?? undefined));
    for (const d of visible) {
      applyTopSecretGate(d, `live:${d.id}`);
    }
    return { success: true, documents: visible };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:getById', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    const sql = `SELECT ${DOCUMENT_SELECT_COLUMNS} FROM documents d JOIN document_types dt ON d.type_id = dt.id WHERE d.id = ?`;
    const rows = query(sql, [id]) as Array<Record<string, unknown>>;
    if (rows.length === 0) return { success: false, error: 'الوثيقة غير موجودة' };
    const doc = rows[0];
    if (!canTouchDocument(user, { org_unit_id: doc.org_unit_id as number | null, created_by: doc.created_by as string | null })) {
      return { success: false, error: 'ليس لديك صلاحية الوصول لهذه الوثيقة' };
    }
    const conf = doc.confidentiality as string;
    if (!canAccessConfidentiality(user, conf, (doc.created_by as string) ?? undefined)) {
      return { success: false, error: 'ليس لديك صلاحية الوصول لهذه الوثيقة' };
    }
    applyTopSecretGate(doc, `live:${id}`);
    return { success: true, document: doc };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

function validateDocumentInput(doc: Record<string, unknown>, isCreate: boolean): string | null {
  if (isCreate && !doc.ref_number) return 'الرقم المرجعي مطلوب';
  if (!doc.type_id) return 'نوع الملف مطلوب';
  if (!doc.folder_id) return 'المجلد مطلوب';
  if (!doc.date) return 'التاريخ مطلوب';
  if (!doc.sender) return 'المرسل مطلوب';
  if (!doc.receiver) return 'المستلم مطلوب';
  if (!doc.subject) return 'الموضوع مطلوب';
  if (!doc.confidentiality) return 'مستوى السرية مطلوب';
  return null;
}

ipcMain.handle('document:create', (_event: IpcMainInvokeEvent, doc: Record<string, unknown>) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };

    const validationError = validateDocumentInput(doc, true);
    if (validationError) return { success: false, error: validationError };

    const requestedOrgUnitId = (doc.org_unit_id as number | null | undefined) ?? user.org_unit_id ?? null;
    if (!hasMinRole(user, 'deputy_manager')) {
      const isHead = user.role === 'dept_head' || user.role === 'section_head';
      if (isHead && user.org_unit_id != null) {
        // Head with an assigned unit: may only target their own subtree.
        if (requestedOrgUnitId == null || !isUserInSubtree(user.org_unit_id, requestedOrgUnitId)) {
          return { success: false, error: 'لا يمكنك إنشاء وثيقة لوحدة تنظيمية خارج نطاق صلاحياتك' };
        }
      } else if (requestedOrgUnitId !== (user.org_unit_id ?? null)) {
        // Employees, and heads with no assigned unit (no subtree to target),
        // may only create documents with no explicit org unit / their own (null) unit.
        return { success: false, error: 'لا يمكنك إنشاء وثيقة لوحدة تنظيمية أخرى' };
      }
    }

    console.log('[Main] Creating document:', doc.ref_number, 'type_id:', doc.type_id, 'confidentiality:', doc.confidentiality);

    const result = run(`
      INSERT INTO documents (
        ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, author, address, target, content, input_method,
        date, body, notes, status, signature_base64, attachments_json, created_by, org_unit_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      doc.ref_number,
      doc.type_id,
      doc.folder_id,
      doc.confidentiality ?? 'عادي',
      doc.subject,
      doc.sender ?? null,
      doc.receiver ?? null,
      doc.author ?? null,
      doc.writer_name ?? null,
      doc.address ?? null,
      doc.target ?? null,
      doc.content ?? null,
      doc.input_method ?? null,
      doc.date,
      doc.body ?? null,
      doc.notes ?? null,
      doc.status ?? 'قيد الاعتماد',
      doc.signature_base64 ?? null,
      doc.attachments_json ?? '[]',
      user.username,
      requestedOrgUnitId
    ]);
    addAudit('إنشاء وثيقة', doc.ref_number as string, doc.subject as string, user.username);
    return { success: true, id: Number(result.lastInsertRowid) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:update', (_event: IpcMainInvokeEvent, doc: Record<string, unknown>) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'ليس لديك صلاحية تعديل وثيقة' };
    if (!doc.id) return { success: false, error: 'معرف الوثيقة مطلوب' };

    const validationError = validateDocumentInput(doc, false);
    if (validationError) return { success: false, error: validationError };

    const existingRows = query('SELECT confidentiality, created_by, org_unit_id FROM documents WHERE id = ?', [doc.id]) as
      Array<{ confidentiality: string; created_by: string | null; org_unit_id: number | null }>;
    if (existingRows.length === 0) return { success: false, error: 'الوثيقة غير موجودة' };
    const existing = existingRows[0];

    if (!canTouchDocument(user, existing)) {
      return { success: false, error: 'ليس لديك صلاحية الوصول لهذه الوثيقة' };
    }
    if (!canAccessConfidentiality(user, existing.confidentiality, existing.created_by ?? undefined)) {
      return { success: false, error: 'ليس لديك صلاحية تعديل هذه الوثيقة' };
    }

    let orgUnitId = existing.org_unit_id;
    if (doc.org_unit_id !== undefined && doc.org_unit_id !== existing.org_unit_id) {
      const target = doc.org_unit_id as number | null;
      if (hasMinRole(user, 'deputy_manager')) {
        orgUnitId = target;
      } else if (user.role === 'dept_head' || user.role === 'section_head') {
        if (target != null && user.org_unit_id != null && isUserInSubtree(user.org_unit_id, target)) {
          orgUnitId = target;
        } else {
          return { success: false, error: 'لا يمكنك نقل الوثيقة لوحدة تنظيمية خارج نطاق صلاحياتك' };
        }
      }
      // employees cannot move a document's org unit; the requested change is ignored.
    }

    run(`
      UPDATE documents SET
        ref_number = ?, type_id = ?, folder_id = ?, confidentiality = ?, subject = ?, sender = ?, receiver = ?,
        author = ?, address = ?, target = ?, content = ?, input_method = ?,
        date = ?, body = ?, notes = ?, status = ?, signature_base64 = ?, attachments_json = ?, org_unit_id = ?,
        updated_at = strftime('%s','now')
      WHERE id = ?
    `, [
      doc.ref_number,
      doc.type_id,
      doc.folder_id,
      doc.confidentiality ?? 'عادي',
      doc.subject,
      doc.sender ?? null,
      doc.receiver ?? null,
      doc.author ?? null,
      doc.writer_name ?? null,
      doc.address ?? null,
      doc.target ?? null,
      doc.content ?? null,
      doc.input_method ?? null,
      doc.date,
      doc.body ?? null,
      doc.notes ?? null,
      doc.status ?? 'قيد الاعتماد',
      doc.signature_base64 ?? null,
      doc.attachments_json ?? '[]',
      orgUnitId,
      doc.id
    ]);
    addAudit('تعديل وثيقة', doc.ref_number as string, doc.subject as string, user.username);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:delete', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'ليس لديك صلاحية حذف وثيقة' };

    const existing = query('SELECT ref_number, subject, confidentiality, created_by, org_unit_id FROM documents WHERE id = ?', [id]) as
      Array<{ ref_number: string; subject: string; confidentiality: string; created_by: string | null; org_unit_id: number | null }>;
    if (existing.length === 0) return { success: false, error: 'الوثيقة غير موجودة' };
    if (!canTouchDocument(user, existing[0])) {
      return { success: false, error: 'ليس لديك صلاحية الوصول لهذه الوثيقة' };
    }
    if (!canAccessConfidentiality(user, existing[0].confidentiality, existing[0].created_by ?? undefined)) {
      return { success: false, error: 'ليس لديك صلاحية حذف هذه الوثيقة' };
    }

    run('DELETE FROM documents WHERE id = ?', [id]);
    addAudit('حذف وثيقة', existing[0].ref_number, existing[0].subject, user.username);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Security handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('security:listCodes', () => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    return { success: true, codes: listUserCodes() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:generateCode', (_event: IpcMainInvokeEvent, targetUserId: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const target = getUserById(targetUserId);
    if (!target) return { success: false, error: 'المستخدم غير موجود' };
    const result = generateUserCode(targetUserId, user!.id);
    if (result.success) {
      addAudit('توليد رمز تحقق', undefined, `للمستخدم: ${target.username}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:revokeCode', (_event: IpcMainInvokeEvent, codeId: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = revokeUserCode(codeId, user!.id);
    if (result.success) {
      addAudit('إلغاء رمز تحقق', undefined, `المعرف: ${codeId}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:verifyCode', (_event: IpcMainInvokeEvent, code: string, documentId?: number, scope: string = 'live') => {
  try {
    const user = activeUser();
    if (!user) return { valid: false, error: 'يجب تسجيل الدخول' };

    const limitState = checkRateLimit(user.id);
    if (limitState.locked) {
      addAudit('محاولة تحقق أثناء التأمين', undefined, documentId != null ? `الوثيقة: ${documentId}` : undefined, user.username);
      return { valid: false, error: limitState.message };
    }

    const result = verifyAndConsumeUserCode(user.id, code, documentId);
    if (result.success) {
      clearRateLimit(user.id);
      addAudit('تحقق رمز سري ناجح', undefined, documentId != null ? `الوثيقة: ${documentId}` : undefined, user.username);
      if (documentId != null) {
        verifiedTopSecret.add(`${scope}:${documentId}`);
      }
      return { valid: true };
    }

    recordFailedCodeAttempt(user.id);
    addAudit('محاولة تحقق رمز فاشلة', undefined, documentId != null ? `الوثيقة: ${documentId}` : undefined, user.username);
    return { valid: false, error: result.error };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:verifyPassword', (_event: IpcMainInvokeEvent, password: string, documentId?: number, scope: string = 'live') => {
  try {
    const user = activeUser();
    if (!user) return { valid: false, error: 'يجب تسجيل الدخول' };
    initDb();
    const result = authenticateUser(user.username, password);
    // NOTE: password verification alone must NOT unlock سري للغاية (top-secret)
    // documents — that would collapse the two-factor requirement (password +
    // GM/deputy-issued single-use code) down to one factor, since the
    // security-modal runs this step before the code step. Unlocking
    // verifiedTopSecret is the sole responsibility of security:verifyCode.
    return { valid: result.success, error: result.error };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:logAccess', (_event: IpcMainInvokeEvent, documentId: number, accessType: 'view' | 'edit', confidentiality: string, method?: string) => {
  try {
    const user = activeUser();
    if (!user) return { success: false };
    logDocumentAccess(documentId, user.id, user.username, accessType, confidentiality, method);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Password reset handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('passwordReset:request', (_event: IpcMainInvokeEvent, username: string) => {
  try {
    const target = getUserByUsername(username);
    if (!target) return { success: false, error: 'اسم المستخدم غير موجود' };
    const result = requestPasswordReset(target.id, target.username);
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('passwordReset:getPending', () => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'section_head')) return { success: false, error: 'ليس لديك صلاحية' };
    const requests = getPendingPasswordResetRequests().filter(r => {
      const target = getUserById(r.user_id);
      return !!target && canApprovePasswordResetRequest(user!, target);
    });
    return { success: true, requests };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('passwordReset:approve', (_event: IpcMainInvokeEvent, requestId: number, newPassword: string) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'section_head')) return { success: false, error: 'ليس لديك صلاحية' };
    const req = getPendingPasswordResetRequests().find(r => r.id === requestId);
    if (!req) return { success: false, error: 'الطلب غير موجود' };
    const target = getUserById(req.user_id);
    if (!target || !canApprovePasswordResetRequest(user!, target)) return { success: false, error: 'ليس لديك صلاحية' };
    const result = approvePasswordReset(requestId, newPassword, user!.id);
    if (result.success) {
      addAudit('موافقة إعادة تعيين كلمة المرور', undefined, `معرف الطلب: ${requestId}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('passwordReset:reject', (_event: IpcMainInvokeEvent, requestId: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'section_head')) return { success: false, error: 'ليس لديك صلاحية' };
    const req = getPendingPasswordResetRequests().find(r => r.id === requestId);
    if (!req) return { success: false, error: 'الطلب غير موجود' };
    const target = getUserById(req.user_id);
    if (!target || !canApprovePasswordResetRequest(user!, target)) return { success: false, error: 'ليس لديك صلاحية' };
    const result = rejectPasswordReset(requestId);
    if (result.success) {
      addAudit('رفض إعادة تعيين كلمة المرور', undefined, `معرف الطلب: ${requestId}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('passwordReset:adminReset', (_event: IpcMainInvokeEvent, userId: number, newPassword: string) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'section_head')) return { success: false, error: 'ليس لديك صلاحية' };
    const target = getUserById(userId);
    if (!target || !canResetPasswordOf(user!, target)) return { success: false, error: 'ليس لديك صلاحية' };
    const result = adminResetPassword(userId, newPassword);
    if (result.success) {
      addAudit('إعادة تعيين كلمة المرور', undefined, `المستخدم: ${target.username}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('passwordReset:changeOwnPassword', (_event: IpcMainInvokeEvent, currentPassword: string, newPassword: string) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    const result = changeOwnPassword(user.id, currentPassword, newPassword);
    if (result.success) {
      addAudit('تغيير كلمة المرور', undefined, `المستخدم: ${user.username}`, user.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Annual closing handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('annualClosing:getArchivedYears', () => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    return { success: true, years: getArchivedYears() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('annualClosing:closeYear', (_event: IpcMainInvokeEvent, year: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'general_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = closeYear(year, user!.id);
    if (result.success) {
      addAudit('إغلاق سنوي', undefined, `تم إغلاق سنة ${year}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('annualClosing:getArchivedDocuments', (_event: IpcMainInvokeEvent, year: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    return { success: true, documents: getArchivedDocuments(year) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('annualClosing:getArchivedDocumentById', (_event: IpcMainInvokeEvent, year: number, id: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const doc = getArchivedDocumentById(year, id);
    if (!doc) return { success: false, error: 'الوثيقة غير موجودة' };
    applyTopSecretGate(doc, `archive:${year}:${id}`);
    return { success: true, document: doc };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Organizational unit handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('orgUnit:getAll', (_event: IpcMainInvokeEvent, activeOnly = false) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    return { success: true, units: getOrgUnits(activeOnly) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('orgUnit:create', (_event: IpcMainInvokeEvent, data: OrgUnitInput) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = createOrgUnit(data, user!.id);
    if (result.success) {
      addAudit('إنشاء وحدة تنظيمية', undefined, `الاسم: ${data.name}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('orgUnit:update', (_event: IpcMainInvokeEvent, id: number, data: Partial<OrgUnitInput>) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = updateOrgUnit(id, data);
    if (result.success) {
      addAudit('تعديل وحدة تنظيمية', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('orgUnit:delete', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!hasMinRole(user, 'deputy_manager')) return { success: false, error: 'ليس لديك صلاحية' };
    const result = deleteOrgUnit(id);
    if (result.success) {
      addAudit('حذف وحدة تنظيمية', undefined, `المعرف: ${id}`, user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// App helpers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('app:print', () => {
  console.log('[Main] Handling app:print');
  if (!mainWindow) return { success: false, message: 'No main window' };
  return new Promise<{ success: boolean; message: string }>((resolve) => {
    mainWindow!.webContents.print({ silent: false }, (success, failureReason) => {
      resolve({ success, message: success ? '' : failureReason });
    });
  });
});

ipcMain.handle('app:openAttachment', async (_event: IpcMainInvokeEvent, base64: string, name: string, ext: string) => {
  console.log('[Main] Handling app:openAttachment');
  try {
    const safeName = name.replace(/[^a-zA-Z0-9\u0600-\u06FF\-_\.]/g, '_');
    const fileName = `${safeName}_${Date.now()}.${ext}`;
    const tempPath = path.join(app.getPath('temp'), fileName);
    fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));
    const errorMsg = await shell.openPath(tempPath);
    return { success: !errorMsg, path: tempPath, message: errorMsg };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message };
  }
});

app.whenReady().then(() => {
  console.log('[Main] App ready, initializing DB and creating login window');
  registerAppProtocol();
  Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  const initResult = initDb();
  if (!initResult.success) {
    console.error('[Main] Database initialization failed:', initResult.error);
  } else if (initResult.error) {
    console.warn('[Main] Database initialized with fallback:', initResult.error);
  } else {
    console.log('[Main] Database initialized successfully');
  }
  createLoginWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
});
