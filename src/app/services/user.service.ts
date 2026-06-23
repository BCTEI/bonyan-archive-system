import { Injectable } from '@angular/core';
import { User, UserSession, UserFolderPermission } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  async getAll(): Promise<User[]> {
    const result = await window.electronAPI.userAPI.getAll();
    if (!result.success || !result.users) {
      throw new Error(result.error ?? 'فشل تحميل المستخدمين');
    }
    return result.users.map(u => ({ ...u, is_active: !!u.is_active }));
  }

  async getById(id: number): Promise<User | undefined> {
    const result = await window.electronAPI.userAPI.getById(id);
    return result.user ? { ...result.user, is_active: !!result.user.is_active } : undefined;
  }

  async create(user: Omit<User, 'id' | 'created_at' | 'updated_at'> & { password: string; confirmPassword: string }): Promise<number> {
    this.validate(user);
    const result = await window.electronAPI.userAPI.create({
      username: user.username,
      full_name: user.full_name,
      password: user.password,
      role: user.role,
      is_active: user.is_active ? 1 : 0
    });
    if (!result.success) throw new Error(result.error ?? 'فشل إنشاء المستخدم');
    return result.id ?? 0;
  }

  async update(id: number, user: Partial<User> & { password?: string; confirmPassword?: string }): Promise<void> {
    this.validate(user, true);
    const result = await window.electronAPI.userAPI.update(id, {
      username: user.username,
      full_name: user.full_name,
      password: user.password,
      role: user.role,
      is_active: user.is_active !== undefined ? (user.is_active ? 1 : 0) : undefined
    });
    if (!result.success) throw new Error(result.error ?? 'فشل تحديث المستخدم');
  }

  async delete(id: number): Promise<void> {
    const result = await window.electronAPI.userAPI.delete(id);
    if (!result.success) throw new Error(result.error ?? 'فشل حذف المستخدم');
  }

  async toggleStatus(id: number, isActive: boolean): Promise<void> {
    const result = await window.electronAPI.userAPI.toggleStatus(id, isActive ? 1 : 0);
    if (!result.success) throw new Error(result.error ?? 'فشل تغيير الحالة');
  }

  async getSessions(userId?: number): Promise<UserSession[]> {
    const result = await window.electronAPI.userAPI.getSessions(userId);
    if (!result.success || !result.sessions) {
      throw new Error(result.error ?? 'فشل تحميل السجل');
    }
    return result.sessions;
  }

  async getTodaySessions(): Promise<UserSession[]> {
    const result = await window.electronAPI.userAPI.getTodaySessions();
    if (!result.success || !result.sessions) {
      throw new Error(result.error ?? 'فشل تحميل سجل اليوم');
    }
    return result.sessions;
  }

  async getFolderPermissions(userId: number): Promise<UserFolderPermission[]> {
    const result = await window.electronAPI.userAPI.getFolderPermissions(userId);
    if (!result.success || !result.permissions) {
      throw new Error(result.error ?? 'فشل تحميل الصلاحيات');
    }
    return result.permissions;
  }

  async setFolderPermissions(userId: number, permissions: UserFolderPermission[]): Promise<void> {
    const result = await window.electronAPI.userAPI.setFolderPermissions(userId, permissions);
    if (!result.success) throw new Error(result.error ?? 'فشل حفظ الصلاحيات');
  }

  private validate(user: Partial<User> & { password?: string; confirmPassword?: string }, isEdit = false): void {
    const errors: string[] = [];

    if (!isEdit || user.username !== undefined) {
      if (!user.username || user.username.trim().length < 3) {
        errors.push('اسم المستخدم يجب أن يكون 3 أحرف على الأقل');
      } else if (!/^[a-zA-Z0-9_]+$/.test(user.username)) {
        errors.push('اسم المستخدم يجب أن يحتوي على أحرف إنجليزية وأرقام وشرطة سفلية فقط');
      }
    }

    if (user.password) {
      if (user.password.length < 6) {
        errors.push('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      }
      if (user.password !== user.confirmPassword) {
        errors.push('كلمات المرور غير متطابقة');
      }
    } else if (!isEdit) {
      errors.push('كلمة المرور مطلوبة');
    }

    if (!isEdit && !user.role) {
      errors.push('الصلاحية مطلوبة');
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
  }
}
