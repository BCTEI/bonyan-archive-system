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
  // urlPath begins with '/'; strip any host prefix segment we used for routing.
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

  // Missing file: serve index.html for Angular routes (no extension or .html).
  const ext = path.extname(filePath).toLowerCase();
  if (!ext || ext === '.html') {
    return path.join(browserDir, 'index.html');
  }

  // Otherwise keep the path so the renderer gets a real 404.
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
  exportData,
  importData,
  getStats,
  authenticateUser,
  getInitError,
  getUsers,
  getUserById,
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
  AuthUser,
  FolderPermission,
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
  // Re-verify active status from DB if possible
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

function createLoginWindow(): void {
  console.log('[Main] Creating login window');
  loginWindow = new BrowserWindow({
    width: 450,
    height: 600,
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
    minWidth: 1400,
    minHeight: 900,
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

// Register IPC handlers BEFORE app ready (diagnostic requirement)
console.log('[Main] Registering IPC handlers');

ipcMain.handle('db:init', () => {
  console.log('[Main] Handling db:init');
  const result = initDb();
  return result;
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

ipcMain.handle('db:getNextRef', (_event: IpcMainInvokeEvent, type: 'صادر' | 'وارد' | 'مراسلات', folderId: number) => {
  console.log('[Main] Handling db:getNextRef');
  const user = activeUser();
  if (!user) throw new Error('يجب تسجيل الدخول');
  if (!hasPermission(user, ['editor'])) throw new Error('ليس لديك صلاحية التعديل');
  return getNextRef(type, folderId);
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
    // Make sure DB is initialized before attempting login
    const initResult = initDb();
    if (!initResult.success) {
      console.error('[Main] DB init failed:', initResult.error);
      return { success: false, error: initResult.error ?? 'فشل تهيئة قاعدة البيانات' };
    }

    const initErr = getInitError();
    if (initErr && !initResult.error) {
      // Real DB failed but fallback is active
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
