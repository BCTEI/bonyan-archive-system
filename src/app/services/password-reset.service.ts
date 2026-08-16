import { Injectable } from '@angular/core';
import { PasswordResetRequest } from '../models/password-reset.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class PasswordResetService {
  private get api() {
    return window.electronAPI;
  }

  async requestReset(username: string): Promise<void> {
    const result = unwrap(await this.api.passwordResetAPI.request(username), 'فشل إرسال الطلب');
  }

  async getPendingRequests(): Promise<PasswordResetRequest[]> {
    const result = unwrap(await this.api.passwordResetAPI.getPending(), 'فشل تحميل الطلبات');
    return result.requests ?? [];
  }

  async approveRequest(requestId: number, newPassword: string): Promise<void> {
    const result = unwrap(await this.api.passwordResetAPI.approve(requestId, newPassword), 'فشل الموافقة على الطلب');
  }

  async rejectRequest(requestId: number): Promise<void> {
    const result = unwrap(await this.api.passwordResetAPI.reject(requestId), 'فشل رفض الطلب');
  }

  async adminReset(userId: number, newPassword: string): Promise<void> {
    const result = unwrap(await this.api.passwordResetAPI.adminReset(userId, newPassword), 'فشل إعادة تعيين كلمة المرور');
  }

  async changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    const result = unwrap(await this.api.passwordResetAPI.changeOwnPassword(currentPassword, newPassword), 'فشل تغيير كلمة المرور');
  }
}
