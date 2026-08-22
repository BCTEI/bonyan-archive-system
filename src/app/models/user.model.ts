export type UserRole = 'general_manager' | 'deputy_manager' | 'dept_head' | 'section_head' | 'employee';

export interface User {
  id?: number;
  username: string;
  full_name?: string;
  role: UserRole;
  org_unit_id?: number | null;
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
  canManageMasterLists: boolean;
  canManageOrgUnits: boolean;
  canBrowseArchive: boolean;
  canExternalBackup: boolean;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  general_manager: 'المدير العام',
  deputy_manager: 'نائب المدير العام',
  dept_head: 'رئيس إدارة',
  section_head: 'رئيس قسم',
  employee: 'موظف'
};

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  employee: 1,
  section_head: 2,
  dept_head: 3,
  deputy_manager: 4,
  general_manager: 5
};

export function hasRole(userRole: UserRole, required: UserRole | UserRole[]): boolean {
  const requiredRoles = Array.isArray(required) ? required : [required];
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  return requiredRoles.some(r => (ROLE_HIERARCHY[r] ?? 0) <= userLevel);
}

const ALL_PERMISSIONS: RolePermissions = {
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
  canCloseYear: true,
  canManageMasterLists: true,
  canManageOrgUnits: true,
  canBrowseArchive: true,
  canExternalBackup: true
};

// dept_head and section_head: full control over their own documents plus audit
// visibility (server also gates document:audit-adjacent channels at section_head+),
// but no system-wide management capability.
const HEAD_PERMISSIONS: RolePermissions = {
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
  canCloseYear: false,
  canManageMasterLists: false,
  canManageOrgUnits: false,
  canBrowseArchive: false,
  canExternalBackup: false
};

const EMPLOYEE_PERMISSIONS: RolePermissions = {
  canManageUsers: false,
  canCreateDocument: true,
  canEditDocument: false,
  canDeleteDocument: false,
  canViewAudit: false,
  canExportImport: false,
  canClearData: false,
  canManageDocumentTypes: false,
  canManageFolders: false,
  canManageSecurity: false,
  canCloseYear: false,
  canManageMasterLists: false,
  canManageOrgUnits: false,
  canBrowseArchive: false,
  canExternalBackup: false
};

export function getRolePermissions(role: UserRole): RolePermissions {
  const map: Record<UserRole, RolePermissions> = {
    general_manager: ALL_PERMISSIONS,
    deputy_manager: ALL_PERMISSIONS,
    dept_head: HEAD_PERMISSIONS,
    section_head: HEAD_PERMISSIONS,
    employee: EMPLOYEE_PERMISSIONS
  };
  return map[role] ?? EMPLOYEE_PERMISSIONS;
}
