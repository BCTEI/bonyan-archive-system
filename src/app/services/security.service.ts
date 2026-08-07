import { Injectable } from '@angular/core';
import { UserCodeEntry } from '../models/security.model';

// Per-user single-use verification codes (Task 1.1 backend): an admin issues a
// code targeted at a specific user, shown once; that user consumes it against a
// specific document (verifyCode always requires documentId — see
// document-access.service.ts). See electron/main.ts security:* handlers and
// src/types/electron.d.ts for the IPC contract.
@Injectable({
  providedIn: 'root'
})
export class SecurityService {
  private get api() {
    return window.electronAPI;
  }

  async listCodes(): Promise<UserCodeEntry[]> {
    const result = await this.api.securityAPI.listCodes();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الرموز الصادرة');
    return result.codes ?? [];
  }

  async generateCode(userId: number): Promise<{ code: string; expiresAt: number }> {
    const result = await this.api.securityAPI.generateCode(userId);
    if (!result.success || !result.code || result.expiresAt === undefined) {
      throw new Error(result.error ?? 'فشل توليد الرمز');
    }
    return { code: result.code, expiresAt: result.expiresAt };
  }

  async revokeCode(codeId: number): Promise<void> {
    const result = await this.api.securityAPI.revokeCode(codeId);
    if (!result.success) throw new Error(result.error ?? 'فشل إلغاء الرمز');
  }

  /**
   * Verifies (and consumes) the current user's personal one-time code against
   * documentId. documentId is intentionally required by callers even though the
   * IPC signature marks it optional — the main process consumes the code
   * regardless, and only unlocks `${scope}:${documentId}` when documentId is
   * passed, so omitting it would burn the code without unlocking anything.
   */
  async verifyCode(code: string, documentId?: number, scope?: string): Promise<boolean> {
    const result = await this.api.securityAPI.verifyCode(code, documentId, scope);
    if (!result.valid) throw new Error(result.error ?? 'رمز التحقق غير صحيح');
    return true;
  }

  async verifyPassword(password: string, documentId?: number, scope?: string): Promise<boolean> {
    const result = await this.api.securityAPI.verifyPassword(password, documentId, scope);
    if (!result.valid) throw new Error(result.error ?? 'كلمة المرور غير صحيحة');
    return true;
  }

  async logAccess(documentId: number, accessType: 'view' | 'edit', confidentiality: string, method?: string): Promise<void> {
    await this.api.securityAPI.logAccess(documentId, accessType, confidentiality, method);
  }
}
