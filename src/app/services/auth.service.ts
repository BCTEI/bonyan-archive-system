import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { User } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser = signal<User | null>(null);

  constructor(private router: Router) {}

  async login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
    const result = await window.electronAPI.login(username, password);
    if (result.success && result.user) {
      this.currentUser.set({
        username: result.user.username,
        role: result.user.role as 'admin' | 'user'
      });
      return { success: true };
    }
    return { success: false, message: result.message };
  }

  async checkAuth(): Promise<boolean> {
    const user = await window.electronAPI.getCurrentUser();
    if (user) {
      this.currentUser.set({
        username: user.username,
        role: user.role as 'admin' | 'user'
      });
      return true;
    }
    return false;
  }

  async logout(): Promise<void> {
    await window.electronAPI.logout();
    this.currentUser.set(null);
  }

  isAdmin(): boolean {
    return this.currentUser()?.role === 'admin';
  }
}
