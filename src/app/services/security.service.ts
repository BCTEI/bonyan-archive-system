import { Injectable } from '@angular/core';
import { VerificationCode } from '../models/security.model';

// NOTE (Task 1.1 scope spillover): the main-process security surface moved from a
// single global admin-issued code (security:getCurrentCode/generateCode/verifyCode)
// to per-user single-use codes (security:listCodes/generateCode(targetUserId)/
// revokeCode/verifyCode(code, documentId?, scope?)) — see electron/main.ts and
// src/types/electron.d.ts. This service's public method signatures are kept
// unchanged here only so security-center/security-modal keep compiling; the real
// renderer rework (per-user code issuance UI, document-scoped verify calls) is
// Task 1.2's job. getCurrentCode()/generateCode() below are stubs that no longer
// reflect real behavior.
@Injectable({
  providedIn: 'root'
})
export class SecurityService {
  private get api() {
    return window.electronAPI;
  }

  /** @deprecated Global codes were replaced by per-user codes in Task 1.1; reworked in Task 1.2. */
  async getCurrentCode(): Promise<VerificationCode | null> {
    return null;
  }

  /** @deprecated generateCode now requires a target user id; reworked in Task 1.2. */
  async generateCode(): Promise<{ code: string; expiresAt: number }> {
    throw new Error('توليد الرمز يتطلب الآن تحديد المستخدم المستهدف');
  }

  async verifyCode(code: string, documentId?: number, scope?: string): Promise<boolean> {
    const result = await this.api.securityAPI.verifyCode(code, documentId, scope);
    return result.valid;
  }

  async verifyPassword(_username: string, password: string): Promise<boolean> {
    const result = await this.api.securityAPI.verifyPassword(password);
    return result.valid;
  }

  async logAccess(documentId: number, accessType: 'view' | 'edit', confidentiality: string, method?: string): Promise<void> {
    await this.api.securityAPI.logAccess(documentId, accessType, confidentiality, method);
  }
}
