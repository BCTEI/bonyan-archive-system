import { User, UserSession, UserFolderPermission } from '../app/models/user.model';
import { ArchiveDocument, DocumentTypeEntry } from '../app/models/document.model';
import { Folder, FolderInput } from '../app/models/folder.model';
import { DocumentAccessLogEntry } from '../app/models/security.model';
import { PasswordResetRequest } from '../app/models/password-reset.model';
import { ArchivedYear } from '../app/models/annual-closing.model';
import { MasterListEntry, MasterListInput } from '../app/models/master-list.model';
import { AuditEntry } from '../app/models/audit-entry.model';

// `User` (from user.model.ts) now carries org_unit_id directly (Task 3.3, 5-role
// migration), so this alias is just a stable name for the API-surface type — kept so
// existing call sites (login/getCurrentUser/userAPI) don't need to change.
export type UserWithOrgUnit = User;

export interface OrgUnit {
  id: number;
  name: string;
  unit_type: 'administration' | 'section';
  parent_id: number | null;
  is_active: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface OrgUnitInput {
  name: string;
  unit_type: 'administration' | 'section';
  parent_id?: number | null;
  is_active?: number;
}

export interface UserCodeEntry {
  id: number;
  user_id: number;
  username: string;
  full_name: string | null;
  status: 'active' | 'used' | 'revoked' | 'expired';
  generated_by: number | null;
  generated_by_name: string | null;
  generated_at: number;
  expires_at: number;
  used_at: number | null;
  used_document_id: number | null;
  revoked_by: number | null;
  revoked_at: number | null;
}

export interface ElectronAPI {
  dbInit: () => Promise<boolean>;
  dbQuery: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  dbRun: (sql: string, params?: unknown[]) => Promise<{ lastInsertRowid: number | bigint; changes: number }>;
  getNextRef: (typeId: number, folderId: number) => Promise<string>;
  exportData: () => Promise<string>;
  importData: (jsonData: string, mode: 'merge' | 'replace') => Promise<{ success: boolean; message: string }>;
  addAudit: (action: string, docRef?: string, details?: string) => Promise<boolean>;
  getStats: () => Promise<{ success: boolean; stats?: { total: number; [key: string]: number }; error?: string }>;
  auditAPI: {
    clearAll: () => Promise<{ success: boolean; error?: string }>;
    addEntry: (entry: { action: string; doc_ref?: string; details?: string; username?: string }) => Promise<{ success: boolean; error?: string }>;
    list: (limit?: number) => Promise<{ success: boolean; entries?: AuditEntry[]; error?: string }>;
  };
  print: () => Promise<{ success: boolean; message: string }>;
  openAttachment: (base64: string, name: string, ext: string) => Promise<{ success: boolean; path?: string; message?: string }>;

  login: (username: string, password: string) => Promise<{ success: boolean; user?: UserWithOrgUnit; error?: string; message?: string }>;
  getCurrentUser: () => Promise<UserWithOrgUnit | null>;
  logout: () => Promise<boolean>;
  verifyPassword: (username: string, password: string) => Promise<boolean>;
  getDbPath: () => Promise<{ success: boolean; path?: string; error?: string }>;
  getDbStatus: () => Promise<{ success: boolean; fallback: boolean; error: string | null }>;

  userAPI: {
    getAll: () => Promise<{ success: boolean; users?: UserWithOrgUnit[]; error?: string }>;
    getById: (id: number) => Promise<{ success: boolean; user?: UserWithOrgUnit; error?: string }>;
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
    getAllWithCounts: () => Promise<{ success: boolean; folders?: Folder[]; error?: string }>;
  };

  securityAPI: {
    listCodes: () => Promise<{ success: boolean; codes?: UserCodeEntry[]; error?: string }>;
    generateCode: (targetUserId: number) => Promise<{ success: boolean; code?: string; expiresAt?: number; error?: string }>;
    revokeCode: (codeId: number) => Promise<{ success: boolean; error?: string }>;
    verifyCode: (code: string, documentId?: number, scope?: string) => Promise<{ valid: boolean; error?: string }>;
    verifyPassword: (password: string, documentId?: number, scope?: string) => Promise<{ valid: boolean; error?: string }>;
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
    getArchivedDocumentById: (year: number, id: number) => Promise<{ success: boolean; document?: unknown; error?: string }>;
  };

  masterListAPI: {
    getAll: (listType?: string, activeOnly?: boolean) => Promise<{ success: boolean; items?: MasterListEntry[]; error?: string }>;
    create: (data: MasterListInput) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (id: number, data: Partial<MasterListInput>) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    toggleStatus: (id: number, isActive: number) => Promise<{ success: boolean; error?: string }>;
  };

  orgUnitAPI: {
    getAll: (activeOnly?: boolean) => Promise<{ success: boolean; units?: OrgUnit[]; error?: string }>;
    create: (data: OrgUnitInput) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (id: number, data: Partial<OrgUnitInput>) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
