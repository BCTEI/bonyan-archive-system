import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models/user.model';

export const roleGuard = async (required: UserRole[]): Promise<boolean> => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ok = await auth.checkAuth() && auth.can(required);
  if (!ok) {
    await router.navigate(['/main/dashboard']);
    return false;
  }
  return true;
};
