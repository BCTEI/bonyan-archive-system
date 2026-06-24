export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id?: number;
  username: string;
  full_name?: string;
  role: UserRole;
  is_active?: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface UserSession {
  id?: number;
  user_id: number;
  username: string;
  action: 'login' | 'logout';
  ip_address?: string;
  device_info?: string;
  timestamp?: number;
}

export interface UserFolderPermission {
  folder_id: number;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface RolePermissions {
  canManageUsers: boolean;
  canCreateDocument: boolean;
  canEditDocument: boolean;
  canDeleteDocument: boolean;
  canViewAudit: boolean;
  canExportImport: boolean;
  canClearData: boolean;
  canManageDocumentTypes: boolean;
  canManageFolders: boolean;
  canManageSecurity: boolean;
  canCloseYear: boolean;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'مدير النظام',
  editor: 'محرر',
  viewer: 'مشاهد فقط'
};

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3
};

export function hasRole(userRole: UserRole, required: UserRole | UserRole[]): boolean {
  const requiredRoles = Array.isArray(required) ? required : [required];
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  return requiredRoles.some(r => (ROLE_HIERARCHY[r] ?? 0) <= userLevel);
}

export function getRolePermissions(role: UserRole): RolePermissions {
  const map: Record<UserRole, RolePermissions> = {
    admin: {
      canManageUsers: true,
      canCreateDocument: true,
      canEditDocument: true,
      canDeleteDocument: true,
      canViewAudit: true,
      canExportImport: true,
      canClearData: true,
      canManageDocumentTypes: true,
      canManageFolders: true,
      canManageSecurity: true,
      canCloseYear: true
    },
    editor: {
      canManageUsers: false,
      canCreateDocument: true,
      canEditDocument: true,
      canDeleteDocument: true,
      canViewAudit: true,
      canExportImport: false,
      canClearData: false,
      canManageDocumentTypes: false,
      canManageFolders: false,
      canManageSecurity: false,
      canCloseYear: false
    },
    viewer: {
      canManageUsers: false,
      canCreateDocument: false,
      canEditDocument: false,
      canDeleteDocument: false,
      canViewAudit: false,
      canExportImport: false,
      canClearData: false,
      canManageDocumentTypes: false,
      canManageFolders: false,
      canManageSecurity: false,
      canCloseYear: false
    }
  };
  return map[role] ?? map.viewer;
}
