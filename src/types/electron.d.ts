import { User, UserSession, UserFolderPermission } from '../app/models/user.model';
import { ArchiveDocument, DocumentTypeEntry } from '../app/models/document.model';
import { Folder, FolderInput } from '../app/models/folder.model';
import { VerificationCode, DocumentAccessLogEntry } from '../app/models/security.model';
import { PasswordResetRequest } from '../app/models/password-reset.model';
import { ArchivedYear } from '../app/models/annual-closing.model';

export interface ElectronAPI {
  dbInit: () => Promise<boolean>;
  dbQuery: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  dbRun: (sql: string, params?: unknown[]) => Promise<{ lastInsertRowid: number | bigint; changes: number }>;
  getNextRef: (typeId: number, folderId: number) => Promise<string>;
  exportData: () => Promise<string>;
  importData: (jsonData: string, mode: 'merge' | 'replace') => Promise<{ success: boolean; message: string }>;
  addAudit: (action: string, docRef?: string, details?: string) => Promise<boolean>;
  print: () => Promise<{ success: boolean; message: string }>;
  openAttachment: (base64: string, name: string, ext: string) => Promise<{ success: boolean; path?: string; message?: string }>;

  login: (username: string, password: string) => Promise<{ success: boolean; user?: User; error?: string; message?: string }>;
  getCurrentUser: () => Promise<User | null>;
  logout: () => Promise<boolean>;
  verifyPassword: (username: string, password: string) => Promise<boolean>;
  getDbPath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  getDbStatus: () => Promise<{ success: boolean; fallback: boolean; error: string | null }>;

  userAPI: {
    getAll: () => Promise<{ success: boolean; users?: User[]; error?: string }>;
    getById: (id: number) => Promise<{ success: boolean; user?: User; error?: string }>;
    create: (data: unknown) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (id: number, data: unknown) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    toggleStatus: (id: number, isActive: number) => Promise<{ success: boolean; error?: string }>;
    getSessions: (userId?: number) => Promise<{ success: boolean; sessions?: UserSession[]; error?: string }>;
    getTodaySessions: () => Promise<{ success: boolean; sessions?: UserSession[]; error?: string }>;
    getFolderPermissions: (userId: number) => Promise<{ success: boolean; permissions?: UserFolderPermission[]; error?: string }>;
    getFolderPermission: (userId: number, folderId: number) => Promise<{ success: boolean; permission?: UserFolderPermission | null; error?: string }>;
    setFolderPermissions: (userId: number, permissions: UserFolderPermission[]) => Promise<{ success: boolean; error?: string }>;
  };

  documentAPI: {
    getAll: () => Promise<{ success: boolean; documents?: ArchiveDocument[]; error?: string }>;
    getById: (id: number) => Promise<{ success: boolean; document?: ArchiveDocument; error?: string }>;
    create: (doc: unknown) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (doc: unknown) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  documentTypeAPI: {
    getAll: (activeOnly?: boolean) => Promise<{ success: boolean; types?: DocumentTypeEntry[]; error?: string }>;
    getById: (id: number) => Promise<{ success: boolean; type?: DocumentTypeEntry; error?: string }>;
    create: (data: unknown) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (id: number, data: unknown) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  folderCategoryAPI: {
    getAll: (activeOnly?: boolean) => Promise<{ success: boolean; folders?: Folder[]; error?: string }>;
    getGroups: () => Promise<{ success: boolean; groups?: string[]; error?: string }>;
    getById: (id: number) => Promise<{ success: boolean; folder?: Folder; error?: string }>;
    create: (data: FolderInput) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (id: number, data: Partial<FolderInput>) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  securityAPI: {
    getCurrentCode: () => Promise<{ success: boolean; code?: VerificationCode | null; error?: string }>;
    generateCode: () => Promise<{ success: boolean; code?: string; expiresAt?: number; error?: string }>;
    verifyCode: (code: string) => Promise<{ valid: boolean; error?: string }>;
    verifyPassword: (username: string, password: string) => Promise<{ valid: boolean; error?: string }>;
    logAccess: (documentId: number, accessType: 'view' | 'edit', confidentiality: string, method?: string) => Promise<{ success: boolean; error?: string }>;
  };

  passwordResetAPI: {
    request: (username: string) => Promise<{ success: boolean; error?: string }>;
    getPending: () => Promise<{ success: boolean; requests?: PasswordResetRequest[]; error?: string }>;
    approve: (requestId: number, newPassword: string) => Promise<{ success: boolean; error?: string }>;
    reject: (requestId: number) => Promise<{ success: boolean; error?: string }>;
    adminReset: (userId: number, newPassword: string) => Promise<{ success: boolean; error?: string }>;
    changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  };

  annualClosingAPI: {
    getArchivedYears: () => Promise<{ success: boolean; years?: ArchivedYear[]; error?: string }>;
    closeYear: (year: number) => Promise<{ success: boolean; message?: string; error?: string; backupPath?: string }>;
    getArchivedDocuments: (year: number) => Promise<{ success: boolean; documents?: unknown[]; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
