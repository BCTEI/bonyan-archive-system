import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { RolePermissions, getRolePermissions } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private auth = inject(AuthService);

  get rolePermissions(): RolePermissions {
    const role = this.auth.currentUser()?.role;
    return getRolePermissions(role ?? 'viewer');
  }

  hasPermission(key: keyof RolePermissions): boolean {
    return this.rolePermissions[key] ?? false;
  }
}
