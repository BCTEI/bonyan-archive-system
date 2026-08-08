import { contextBridge, ipcRenderer } from 'electron';

// Securely expose only the APIs the Angular renderer needs.
// NEVER expose raw ipcRenderer to the renderer process.
contextBridge.exposeInMainWorld('electronAPI', {
  dbInit: () => ipcRenderer.invoke('db:init'),
  dbQuery: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
  dbRun: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', sql, params),
  exportData: () => ipcRenderer.invoke('db:export'),
  importData: (jsonData: string, mode: 'merge' | 'replace') => ipcRenderer.invoke('db:import', jsonData, mode),
  addAudit: (action: string, docRef?: string, details?: string) => ipcRenderer.invoke('db:audit', action, docRef, details),
  auditAPI: {
    clearAll: () => ipcRenderer.invoke('audit:clearAll'),
    addEntry: (entry: { action: string; doc_ref?: string; details?: string; username?: string }) => ipcRenderer.invoke('audit:addEntry', entry),
  },
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
  },

  documentAPI: {
    getAll: () => ipcRenderer.invoke('document:getAll'),
    getById: (id: number) => ipcRenderer.invoke('document:getById', id),
    getByBarcode: (barcode: string) => ipcRenderer.invoke('document:getByBarcode', barcode),
    create: (doc: unknown) => ipcRenderer.invoke('document:create', doc),
    update: (doc: unknown) => ipcRenderer.invoke('document:update', doc),
    delete: (id: number) => ipcRenderer.invoke('document:delete', id),
  },

  documentTypeAPI: {
    getAll: (activeOnly?: boolean) => ipcRenderer.invoke('documentType:getAll', activeOnly),
    getById: (id: number) => ipcRenderer.invoke('documentType:getById', id),
    create: (data: unknown) => ipcRenderer.invoke('documentType:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('documentType:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('documentType:delete', id),
  },

  folderCategoryAPI: {
    getAll: (activeOnly?: boolean) => ipcRenderer.invoke('folderCategory:getAll', activeOnly),
    getGroups: () => ipcRenderer.invoke('folderCategory:getGroups'),
    getById: (id: number) => ipcRenderer.invoke('folderCategory:getById', id),
    create: (data: unknown) => ipcRenderer.invoke('folderCategory:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('folderCategory:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('folderCategory:delete', id),
  },

  securityAPI: {
    getCurrentCode: () => ipcRenderer.invoke('security:getCurrentCode'),
    generateCode: () => ipcRenderer.invoke('security:generateCode'),
    verifyCode: (code: string) => ipcRenderer.invoke('security:verifyCode', code),
    verifyPassword: (username: string, password: string) => ipcRenderer.invoke('security:verifyPassword', username, password),
    logAccess: (documentId: number, accessType: 'view' | 'edit', confidentiality: string, method?: string) =>
      ipcRenderer.invoke('document:logAccess', documentId, accessType, confidentiality, method),
  },

  passwordResetAPI: {
    request: (username: string) => ipcRenderer.invoke('passwordReset:request', username),
    getPending: () => ipcRenderer.invoke('passwordReset:getPending'),
    approve: (requestId: number, newPassword: string) => ipcRenderer.invoke('passwordReset:approve', requestId, newPassword),
    reject: (requestId: number) => ipcRenderer.invoke('passwordReset:reject', requestId),
    adminReset: (userId: number, newPassword: string) => ipcRenderer.invoke('passwordReset:adminReset', userId, newPassword),
    changeOwnPassword: (currentPassword: string, newPassword: string) =>
      ipcRenderer.invoke('passwordReset:changeOwnPassword', currentPassword, newPassword),
  },

  annualClosingAPI: {
    getArchivedYears: () => ipcRenderer.invoke('annualClosing:getArchivedYears'),
    closeYear: (year: number) => ipcRenderer.invoke('annualClosing:closeYear', year),
    getArchivedDocuments: (year: number) => ipcRenderer.invoke('annualClosing:getArchivedDocuments', year),
  },

  masterListAPI: {
    getAll: (listType?: string, activeOnly?: boolean) => ipcRenderer.invoke('masterList:getAll', listType, activeOnly),
    create: (data: unknown) => ipcRenderer.invoke('masterList:create', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('masterList:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('masterList:delete', id),
    toggleStatus: (id: number, isActive: number) => ipcRenderer.invoke('masterList:toggleStatus', id, isActive),
  }
});

console.log('[Preload] electronAPI exposed securely via contextBridge');
