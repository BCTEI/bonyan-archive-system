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
  generateArchiveRefNumber,
  generateDocumentBarcode,
  addAudit,
  clearAudit,
  exportData,
  importData,
  getStats,
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
  getCurrentVerificationCode,
  generateVerificationCode,
  verifySystemCode,
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
  getMasterLists,
  createMasterList,
  updateMasterList,
  deleteMasterList,
  toggleMasterListStatus,
  AuthUser,
  FolderPermission,
  DocumentTypeInput,
  FolderInput,
} from './database';

let loginWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let currentUser: AuthUser | null = null;

const ROLE_LEVEL: Record<string, number> = {
  viewer: 1,
  editor: 2,
  admin: 3
};

function hasPermission(user: AuthUser | null, required: string[]): boolean {
  if (!user) return false;
  const userLevel = ROLE_LEVEL[user.role] ?? 0;
  return required.some(r => (ROLE_LEVEL[r] ?? 0) <= userLevel);
}

function activeUser(): AuthUser | null {
  if (!currentUser) return null;
  try {
    const fresh = getUserById(currentUser.id);
    if (fresh && fresh.is_active !== 1) {
      currentUser = null;
      return null;
    }
  } catch {
    // ignore in fallback/memory mode
  }
  return currentUser;
}

function canAccessConfidentiality(role: string, confidentiality: string): boolean {
  if (confidentiality === 'عادي') return true;
  if (confidentiality === 'سري') return role === 'admin' || role === 'editor';
  if (confidentiality === 'سري للغاية') return role === 'admin';
  return false;
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
  return query(sql, params);
});

ipcMain.handle('db:run', (_event: IpcMainInvokeEvent, sql: string, params?: unknown[]) => {
  console.log('[Main] Handling db:run');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasPermission(user, ['editor'])) return { success: false, error: 'ليس لديك صلاحية التعديل' };
  return run(sql, params);
});

ipcMain.handle('db:export', () => {
  console.log('[Main] Handling db:export');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasPermission(user, ['editor'])) return { success: false, error: 'ليس لديك صلاحية التصدير' };
  return exportData();
});

ipcMain.handle('db:import', (_event: IpcMainInvokeEvent, jsonData: string, mode: 'merge' | 'replace') => {
  console.log('[Main] Handling db:import');
  const user = activeUser();
  if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
  if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية الاستيراد' };
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

ipcMain.handle('db:stats', () => {
  console.log('[Main] Handling db:stats');
  return getStats();
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
  }
  currentUser = null;
  createLoginWindow();
  if (mainWindow) mainWindow.close();
  return true;
});

ipcMain.handle('auth:verifyPassword', (_event: IpcMainInvokeEvent, username: string, password: string) => {
  console.log('[Main] Handling auth:verifyPassword for:', username);
  try {
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
    if (!hasPermission(user, ['admin'])) {
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
    if (!hasPermission(user, ['admin'])) {
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
    if (!hasPermission(user, ['admin'])) {
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
    if (!hasPermission(user, ['admin'])) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
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
    if (!hasPermission(user, ['admin'])) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const target = getUserById(id);
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
    if (!hasPermission(user, ['admin'])) {
      return { success: false, error: 'ليس لديك صلاحية إدارة المستخدمين' };
    }
    const target = getUserById(id);
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
    if (!hasPermission(user, ['admin']) && userId !== user?.id) {
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
    if (!hasPermission(user, ['admin']) && userId !== user?.id) {
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
    if (user.id !== userId && !hasPermission(user, ['admin'])) {
      return { success: false, error: 'ليس لديك صلاحية' };
    }
    const target = getUserById(userId);
    const perm = getFolderPermission(userId, folderId, target?.role ?? 'viewer');
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
    if (!hasPermission(user, ['admin'])) {
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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

ipcMain.handle('document:getAll', () => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    let sql = 'SELECT d.*, dt.name as type, dt.label as type_label, dt.color as type_color, dt.icon as type_icon FROM documents d JOIN document_types dt ON d.type_id = dt.id';
    if (user.role === 'viewer') {
      sql += " WHERE d.confidentiality = 'عادي'";
    }
    sql += ' ORDER BY d.created_at DESC';
    const docs = query(sql);
    return { success: true, documents: docs };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:getById', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    const sql = 'SELECT d.*, dt.name as type, dt.label as type_label, dt.color as type_color, dt.icon as type_icon FROM documents d JOIN document_types dt ON d.type_id = dt.id WHERE d.id = ?';
    const rows = query(sql, [id]) as Array<Record<string, unknown>>;
    if (rows.length === 0) return { success: false, error: 'الوثيقة غير موجودة' };
    const doc = rows[0];
    const conf = doc.confidentiality as string;
    if (!canAccessConfidentiality(user.role, conf)) {
      return { success: false, error: 'ليس لديك صلاحية الوصول لهذه الوثيقة' };
    }
    return { success: true, document: doc };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// Resolves a scanned/typed barcode to its document. The barcode never carries
// document data itself, so this still enforces the same login + confidentiality
// checks as document:getById — a manipulated or guessed value can only ever
// resolve to a real row, never bypass access control.
ipcMain.handle('document:getByBarcode', (_event: IpcMainInvokeEvent, barcode: unknown) => {
  try {
    const user = activeUser();
    if (!user) return { success: false, error: 'يجب تسجيل الدخول' };
    if (typeof barcode !== 'string') {
      return { success: false, error: 'رمز الباركود غير صالح' };
    }
    const trimmed = barcode.trim();
    // Current format: the barcode column holds only the variable part of the
    // ref_number, with the fixed "م.ب/" prefix stripped (e.g. "58/1" for
    // "م.ب/58/1") — see generateDocumentBarcode in electron/database.ts.
    // Labels printed before that change may still encode the full reference,
    // either with the Arabic prefix or the older ASCII transliteration
    // "MB/58/1", so both are also accepted and resolved back to the same
    // document by trying both the barcode column and the ref_number column.
    const asciiFormat = /^\d+\/\d+$/.test(trimmed);
    const arabicPrefixFormat = /^م\.ب\/\d+\/\d+$/.test(trimmed);
    const legacyFormat = /^MB\/\d+\/\d+$/.test(trimmed);
    if (!asciiFormat && !arabicPrefixFormat && !legacyFormat) {
      return { success: false, error: 'رمز الباركود غير صالح' };
    }
    let barcodeValue: string;
    let refNumberValue: string;
    if (asciiFormat) {
      barcodeValue = trimmed;
      refNumberValue = `م.ب/${trimmed}`;
    } else if (arabicPrefixFormat) {
      barcodeValue = trimmed.replace(/^م\.ب\//, '');
      refNumberValue = trimmed;
    } else {
      barcodeValue = trimmed.replace(/^MB\//, '');
      refNumberValue = trimmed.replace('MB', 'م.ب');
    }
    const sql = 'SELECT d.*, dt.name as type, dt.label as type_label, dt.color as type_color, dt.icon as type_icon FROM documents d JOIN document_types dt ON d.type_id = dt.id WHERE d.barcode = ? OR d.ref_number = ?';
    const rows = query(sql, [barcodeValue, refNumberValue]) as Array<Record<string, unknown>>;
    if (rows.length === 0) return { success: false, error: 'لم يتم العثور على وثيقة بهذا الباركود' };
    const doc = rows[0];
    const conf = doc.confidentiality as string;
    if (!canAccessConfidentiality(user.role, conf)) {
      return { success: false, error: 'ليس لديك صلاحية الوصول لهذه الوثيقة' };
    }
    return { success: true, document: doc };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

function validateDocumentInput(doc: Record<string, unknown>, isCreate: boolean): string | null {
  // ref_number is server-generated on create (see generateArchiveRefNumber) and
  // therefore never required from the client here; on update the existing
  // ref_number simply passes through unchanged.
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
    if (!hasPermission(user, ['editor'])) return { success: false, error: 'ليس لديك صلاحية إنشاء وثيقة' };

    const validationError = validateDocumentInput(doc, true);
    if (validationError) return { success: false, error: validationError };

    const folderId = Number(doc.folder_id);
    if (!Number.isInteger(folderId)) return { success: false, error: 'المجلد غير صالح' };

    // Reference number is always generated here, server-side, from the yearly
    // archive sequence — never trusted from the client — so it can't collide,
    // be spoofed, or drift out of sequence.
    const { ref_number } = generateArchiveRefNumber(folderId);

    console.log('[Main] Creating document:', ref_number, 'type_id:', doc.type_id, 'confidentiality:', doc.confidentiality);

    const result = run(`
      INSERT INTO documents (
        ref_number, type_id, folder_id, confidentiality, subject, sender, receiver, author, address, target, content, input_method,
        date, body, notes, status, signature_base64, attachments_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      ref_number,
      doc.type_id,
      folderId,
      doc.confidentiality ?? 'عادي',
      doc.subject,
      doc.sender ?? null,
      doc.receiver ?? null,
      doc.author ?? null,
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
      user?.username
    ]);
    const id = Number(result.lastInsertRowid);

    // Barcode encodes this document's own ref_number verbatim — see
    // generateDocumentBarcode.
    const barcode = generateDocumentBarcode(ref_number);
    run('UPDATE documents SET barcode = ? WHERE id = ?', [barcode, id]);

    addAudit('إنشاء وثيقة', ref_number, doc.subject as string, user?.username);
    return { success: true, id, ref_number, barcode };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:update', (_event: IpcMainInvokeEvent, doc: Record<string, unknown>) => {
  try {
    const user = activeUser();
    if (!user || !hasPermission(user, ['editor'])) return { success: false, error: 'ليس لديك صلاحية تعديل وثيقة' };
    if (!doc.id) return { success: false, error: 'معرف الوثيقة مطلوب' };

    const validationError = validateDocumentInput(doc, false);
    if (validationError) return { success: false, error: validationError };

    const existing = query('SELECT confidentiality FROM documents WHERE id = ?', [doc.id]) as Array<{ confidentiality: string }>;
    if (existing.length === 0) return { success: false, error: 'الوثيقة غير موجودة' };
    if (!canAccessConfidentiality(user.role, existing[0].confidentiality)) {
      return { success: false, error: 'ليس لديك صلاحية تعديل هذه الوثيقة' };
    }

    run(`
      UPDATE documents SET
        ref_number = ?, type_id = ?, folder_id = ?, confidentiality = ?, subject = ?, sender = ?, receiver = ?,
        author = ?, address = ?, target = ?, content = ?, input_method = ?,
        date = ?, body = ?, notes = ?, status = ?, signature_base64 = ?, attachments_json = ?,
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
      doc.id
    ]);
    addAudit('تعديل وثيقة', doc.ref_number as string, doc.subject as string, user?.username);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('document:delete', (_event: IpcMainInvokeEvent, id: number) => {
  try {
    const user = activeUser();
    if (!user || !hasPermission(user, ['editor'])) return { success: false, error: 'ليس لديك صلاحية حذف وثيقة' };

    const existing = query('SELECT ref_number, subject, confidentiality FROM documents WHERE id = ?', [id]) as Array<{ ref_number: string; subject: string; confidentiality: string }>;
    if (existing.length === 0) return { success: false, error: 'الوثيقة غير موجودة' };
    if (!canAccessConfidentiality(user.role, existing[0].confidentiality)) {
      return { success: false, error: 'ليس لديك صلاحية حذف هذه الوثيقة' };
    }

    run('DELETE FROM documents WHERE id = ?', [id]);
    addAudit('حذف وثيقة', existing[0].ref_number, existing[0].subject, user?.username);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Security handlers
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('security:getCurrentCode', () => {
  try {
    const user = activeUser();
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
    const code = getCurrentVerificationCode();
    return { success: true, code };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:generateCode', () => {
  try {
    const user = activeUser();
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
    const result = generateVerificationCode(user!.id);
    if (result.success) {
      addAudit('توليد رمز تحقق', undefined, 'تم توليد رمز جديد لمركز الأمان', user?.username);
    }
    return result;
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:verifyCode', (_event: IpcMainInvokeEvent, code: string) => {
  try {
    return verifySystemCode(code);
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('security:verifyPassword', (_event: IpcMainInvokeEvent, username: string, password: string) => {
  try {
    initDb();
    const result = authenticateUser(username, password);
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
    return { success: true, requests: getPendingPasswordResetRequests() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('passwordReset:approve', (_event: IpcMainInvokeEvent, requestId: number, newPassword: string) => {
  try {
    const user = activeUser();
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
    const result = adminResetPassword(userId, newPassword);
    if (result.success) {
      const target = getUserById(userId);
      addAudit('إعادة تعيين كلمة المرور', undefined, `المستخدم: ${target?.username ?? userId}`, user?.username);
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
    return { success: true, years: getArchivedYears() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
});

ipcMain.handle('annualClosing:closeYear', (_event: IpcMainInvokeEvent, year: number) => {
  try {
    const user = activeUser();
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
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
    if (!hasPermission(user, ['admin'])) return { success: false, error: 'ليس لديك صلاحية' };
    return { success: true, documents: getArchivedDocuments(year) };
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
