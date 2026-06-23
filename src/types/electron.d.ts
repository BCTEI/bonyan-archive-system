import { User, UserSession, UserFolderPermission } from '../app/models/user.model';

export interface ElectronAPI {
  dbInit: () => Promise<boolean>;
  dbQuery: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  dbRun: (sql: string, params?: unknown[]) => Promise<{ lastInsertRowid: number | bigint; changes: number }>;
  getNextRef: (type: 'صادر' | 'وارد' | 'مراسلات', folderId: number) => Promise<string>;
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
