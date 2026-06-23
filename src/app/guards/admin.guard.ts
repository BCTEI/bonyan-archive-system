import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isAuth = await auth.checkAuth();
  if (!isAuth || !auth.isAdmin()) {
    await router.navigate(['/main/dashboard']);
    return false;
  }
  return true;
};
