import { Injectable, inject } from '@angular/core';
import { UserRole, hasRole, getRolePermissions, RolePermissions, UserFolderPermission } from '../models/user.model';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private auth = inject(AuthService);

  can(required: UserRole | UserRole[]): boolean {
    return this.auth.can(required);
  }

  isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  get rolePermissions(): RolePermissions {
    const role = this.auth.currentUser()?.role ?? 'viewer';
    return getRolePermissions(role);
  }

  hasPermission(key: keyof RolePermissions): boolean {
    return this.rolePermissions[key];
  }

  async canAccessFolder(folderId: number, action: 'view' | 'create' | 'edit' | 'delete'): Promise<boolean> {
    const user = this.auth.currentUser();
    if (!user || !user.id) return false;
    if (user.role === 'admin') return true;

    const result = await window.electronAPI.userAPI.getFolderPermission(user.id, folderId);
    const perm: UserFolderPermission | null | undefined = result.permission;
    if (!perm) return false;

    switch (action) {
      case 'view': return perm.can_view;
      case 'create': return perm.can_create;
      case 'edit': return perm.can_edit;
      case 'delete': return perm.can_delete;
      default: return false;
    }
  }
}
