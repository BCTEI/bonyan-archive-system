import { app, BrowserWindow, ipcMain, Menu, shell, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import {
  initDb,
  query,
  run,
  getNextRef,
  addAudit,
  exportData,
  importData,
  getStats,
} from './database';

let loginWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let currentUser: { username: string; role: string } | null = null;

function createLoginWindow(): void {
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

  loginWindow.loadFile(path.join(__dirname, '../bonyan-archive-system/browser/index.html'), { hash: 'login' });
  loginWindow.on('closed', () => {
    loginWindow = null;
    if (!mainWindow) app.quit();
  });
}

function createMainWindow(): void {
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

  mainWindow.maximize();
  mainWindow.show();
  mainWindow.loadFile(path.join(__dirname, '../bonyan-archive-system/browser/index.html'), { hash: '/main/dashboard' });

  mainWindow.on('closed', () => {
    mainWindow = null;
    currentUser = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  initDb();
  createLoginWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
});

// Database IPC
ipcMain.handle('db:init', () => {
  initDb();
  return true;
});

ipcMain.handle('db:query', (_event: IpcMainInvokeEvent, sql: string, params?: unknown[]) => {
  return query(sql, params);
});

ipcMain.handle('db:run', (_event: IpcMainInvokeEvent, sql: string, params?: unknown[]) => {
  return run(sql, params);
});

ipcMain.handle('db:getNextRef', (_event: IpcMainInvokeEvent, type: 'صادر' | 'وارد' | 'مراسلات', folderId: number) => {
  return getNextRef(type, folderId);
});

ipcMain.handle('db:export', () => {
  return exportData();
});

ipcMain.handle('db:import', (_event: IpcMainInvokeEvent, jsonData: string, mode: 'merge' | 'replace') => {
  return importData(jsonData, mode);
});

ipcMain.handle('db:audit', (_event: IpcMainInvokeEvent, action: string, docRef?: string, details?: string) => {
  addAudit(action, docRef, details, currentUser?.username);
  return true;
});

ipcMain.handle('db:stats', () => {
  return getStats();
});

// Auth IPC
ipcMain.handle('auth:login', (_event: IpcMainInvokeEvent, username: string, password: string) => {
  try {
    const rows = query('SELECT * FROM users WHERE username = ?', [username]) as Array<{
      id: number;
      username: string;
      password_hash: string;
      role: string;
    }>;

    if (rows.length === 0) {
      return { success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    const user = rows[0];
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return { success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }

    currentUser = { username: user.username, role: user.role };
    createMainWindow();
    if (loginWindow) loginWindow.close();

    return { success: true, user: currentUser };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message };
  }
});

ipcMain.handle('auth:getCurrentUser', () => {
  return currentUser;
});

ipcMain.handle('auth:logout', () => {
  currentUser = null;
  createLoginWindow();
  if (mainWindow) mainWindow.close();
  return true;
});

ipcMain.handle('auth:verifyPassword', (_event: IpcMainInvokeEvent, username: string, password: string) => {
  try {
    const rows = query('SELECT password_hash FROM users WHERE username = ?', [username]) as Array<{ password_hash: string }>;
    if (rows.length === 0) return false;
    return bcrypt.compareSync(password, rows[0].password_hash);
  } catch {
    return false;
  }
});

// App IPC
ipcMain.handle('app:print', () => {
  if (!mainWindow) return { success: false, message: 'No main window' };
  return new Promise<{ success: boolean; message: string }>((resolve) => {
    mainWindow!.webContents.print({ silent: false }, (success, failureReason) => {
      resolve({ success, message: success ? '' : failureReason });
    });
  });
});

ipcMain.handle('app:openAttachment', async (_event: IpcMainInvokeEvent, base64: string, name: string, ext: string) => {
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
