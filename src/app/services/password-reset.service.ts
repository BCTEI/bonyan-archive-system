import { Injectable } from '@angular/core';
import { PasswordResetRequest } from '../models/password-reset.model';

@Injectable({
  providedIn: 'root'
})
export class PasswordResetService {
  private get api() {
    return window.electronAPI;
  }

  async requestReset(username: string): Promise<void> {
    const result = await this.api.passwordResetAPI.request(username);
    if (!result.success) throw new Error(result.error ?? 'فشل إرسال الطلب');
  }

  async getPendingRequests(): Promise<PasswordResetRequest[]> {
    const result = await this.api.passwordResetAPI.getPending();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الطلبات');
    return result.requests ?? [];
  }

  async approveRequest(requestId: number, newPassword: string): Promise<void> {
    const result = await this.api.passwordResetAPI.approve(requestId, newPassword);
    if (!result.success) throw new Error(result.error ?? 'فشل الموافقة على الطلب');
  }

  async rejectRequest(requestId: number): Promise<void> {
    const result = await this.api.passwordResetAPI.reject(requestId);
    if (!result.success) throw new Error(result.error ?? 'فشل رفض الطلب');
  }

  async adminReset(userId: number, newPassword: string): Promise<void> {
    const result = await this.api.passwordResetAPI.adminReset(userId, newPassword);
    if (!result.success) throw new Error(result.error ?? 'فشل إعادة تعيين كلمة المرور');
  }

  async changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    const result = await this.api.passwordResetAPI.changeOwnPassword(currentPassword, newPassword);
    if (!result.success) throw new Error(result.error ?? 'فشل تغيير كلمة المرور');
  }
}
