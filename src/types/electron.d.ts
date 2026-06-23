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
  login: (username: string, password: string) => Promise<{ success: boolean; user?: { username: string; role: string }; message?: string }>;
  getCurrentUser: () => Promise<{ username: string; role: string } | null>;
  logout: () => Promise<boolean>;
  verifyPassword: (username: string, password: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
