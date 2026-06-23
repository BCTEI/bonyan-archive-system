import { Injectable, signal, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { User, UserRole, hasRole } from '../models/user.model';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;   // 30 minutes
const INACTIVITY_WARNING_MS = 25 * 60 * 1000; // 25 minutes

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser = signal<User | null>(null);

  private inactivityTimer?: number;
  private warningTimer?: number;
  private lastActivity = Date.now();
  private warningShown = false;

  constructor(private router: Router, private ngZone: NgZone) {
    this.startInactivityTracking();
  }

  async login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
    console.log('[Auth Service] Calling electronAPI.login for:', username);

    try {
      const result = await this.withTimeout(
        window.electronAPI.login(username, password),
        5000,
        'انتهت مهلة الاتصال'
      );

      console.log('[Auth Service] Login result:', result);

      if (result.success && result.user) {
        this.currentUser.set(result.user);
        this.resetInactivityTimer();
        return { success: true };
      }

      const msg = result.error ?? result.message ?? 'فشل تسجيل الدخول';
      return { success: false, message: msg };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ في الاتصال بالنظام';
      console.error('[Auth Service] Login exception:', err);
      return { success: false, message };
    }
  }

  async checkAuth(): Promise<boolean> {
    try {
      const user = await this.withTimeout(
        window.electronAPI.getCurrentUser(),
        5000,
        'انتهت مهلة التحقق'
      );
      if (user) {
        this.currentUser.set(user);
        this.resetInactivityTimer();
        return true;
      }
      return false;
    } catch (err: unknown) {
      console.error('[Auth Service] checkAuth exception:', err);
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.withTimeout(window.electronAPI.logout(), 5000, 'انتهت مهلة تسجيل الخروج');
      this.currentUser.set(null);
      this.clearInactivityTimer();
    } catch (err: unknown) {
      console.error('[Auth Service] Logout exception:', err);
    }
  }

  isAdmin(): boolean {
    return this.currentUser()?.role === 'admin';
  }

  can(required: UserRole | UserRole[]): boolean {
    const role = this.currentUser()?.role;
    if (!role) return false;
    return hasRole(role, required);
  }

  recordActivity(): void {
    this.lastActivity = Date.now();
    this.warningShown = false;
    this.resetInactivityTimer();
  }

  private startInactivityTracking(): void {
    this.ngZone.runOutsideAngular(() => {
      ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
        window.addEventListener(event, () => this.recordActivity(), { passive: true });
      });
    });
    this.resetInactivityTimer();
  }

  private resetInactivityTimer(): void {
    if (!this.currentUser()) return;
    this.clearInactivityTimer();

    this.ngZone.runOutsideAngular(() => {
      this.warningTimer = window.setTimeout(() => this.showInactivityWarning(), INACTIVITY_WARNING_MS);
      this.inactivityTimer = window.setTimeout(() => this.forceLogout(), INACTIVITY_LIMIT_MS);
    });
  }

  private clearInactivityTimer(): void {
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
  }

  private showInactivityWarning(): void {
    if (this.warningShown || !this.currentUser()) return;
    this.warningShown = true;
    this.ngZone.run(() => {
      // Simple browser alert; replace with a custom dialog later if desired.
      window.alert('سيتم تسجيل خروجك تلقائياً خلال 5 دقائق بسبب عدم النشاط.');
    });
  }

  private forceLogout(): void {
    if (!this.currentUser()) return;
    this.ngZone.run(() => {
      window.alert('تم تسجيل خروجك تلقائياً بسبب عدم النشاط.');
      this.logout();
    });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), ms)
      )
    ]);
  }
}
