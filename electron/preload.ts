import { contextBridge, ipcRenderer } from 'electron';

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
  login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
  getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  verifyPassword: (username: string, password: string) => ipcRenderer.invoke('auth:verifyPassword', username, password),
});
