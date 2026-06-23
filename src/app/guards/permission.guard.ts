import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';
import { RolePermissions } from '../models/user.model';

export const permissionGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const permissions = inject(PermissionService);

  const ok = await auth.checkAuth();
  if (!ok) {
    await router.navigate(['/login']);
    return false;
  }

  const key = route.data['permission'] as keyof RolePermissions;
  if (key && !permissions.hasPermission(key)) {
    await router.navigate(['/main/dashboard']);
    return false;
  }
  return true;
};
