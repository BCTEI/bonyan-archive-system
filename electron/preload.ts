import { contextBridge, ipcRenderer } from 'electron';

// Securely expose only the APIs the Angular renderer needs.
// NEVER expose raw ipcRenderer to the renderer process.
contextBridge.exposeInMainWorld('electronAPI', {
  dbInit: () => ipcRenderer.invoke('db:init'),
  dbQuery: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
  dbRun: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', sql, params),
  getNextRef: (type: 'صادر' | 'وارد' | 'مراسلات', folderId: number) => ipcRenderer.invoke('db:getNextRef', type, folderId),
  exportData: () => ipcRenderer.invoke('db:export'),
  importData: (jsonData: string, mode: 'merge' | 'replace') => ipcRenderer.invoke('db:import', jsonData, mode),
  addAudit: (action: string, docRef?: string, details?: string) => ipcRenderer.invoke('db:audit', action, docRef, details),
  print: () => ipcRenderer.invoke('app:print'),
  openAttachment: (base64: string, name: string, ext: string) => ipcRenderer.invoke('app:openAttachment', base64, name, ext),

  login: (username: string, password: string) => {
    console.log('[Preload] Received login request for:', username);
    return ipcRenderer.invoke('auth:login', username, password);
  },
  getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  verifyPassword: (username: string, password: string) => ipcRenderer.invoke('auth:verifyPassword', username, password),
  getDbPath: () => ipcRenderer.invoke('db:getDbPath'),
  getDbStatus: () => ipcRenderer.invoke('db:status'),

  userAPI: {
    getAll: () => ipcRenderer.invoke('user:getAll'),
    getById: (id: number) => ipcRenderer.invoke('user:getById', id),
    create: (data: unknown) => ipcRenderer.invoke('user:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('user:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('user:delete', id),
    toggleStatus: (id: number, isActive: number) => ipcRenderer.invoke('user:toggleStatus', id, isActive),
    getSessions: (userId?: number) => ipcRenderer.invoke('user:getSessions', userId),
    getTodaySessions: () => ipcRenderer.invoke('user:getTodaySessions'),
    getFolderPermissions: (userId: number) => ipcRenderer.invoke('user:getFolderPermissions', userId),
    getFolderPermission: (userId: number, folderId: number) => ipcRenderer.invoke('user:getFolderPermission', userId, folderId),
    setFolderPermissions: (userId: number, permissions: unknown[]) => ipcRenderer.invoke('user:setFolderPermissions', userId, permissions),
  }
});

console.log('[Preload] electronAPI exposed securely via contextBridge');
