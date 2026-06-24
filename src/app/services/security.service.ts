import { Injectable } from '@angular/core';
import { VerificationCode } from '../models/security.model';

@Injectable({
  providedIn: 'root'
})
export class SecurityService {
  private get api() {
    return window.electronAPI;
  }

  async getCurrentCode(): Promise<VerificationCode | null> {
    const result = await this.api.securityAPI.getCurrentCode();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الرمز الحالي');
    return result.code ?? null;
  }

  async generateCode(): Promise<{ code: string; expiresAt: number }> {
    const result = await this.api.securityAPI.generateCode();
    if (!result.success || !result.code) throw new Error(result.error ?? 'فشل توليد الرمز');
    return { code: result.code, expiresAt: result.expiresAt! };
  }

  async verifyCode(code: string): Promise<boolean> {
    const result = await this.api.securityAPI.verifyCode(code);
    return result.valid;
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    const result = await this.api.securityAPI.verifyPassword(username, password);
    return result.valid;
  }

  async logAccess(documentId: number, accessType: 'view' | 'edit', confidentiality: string, method?: string): Promise<void> {
    await this.api.securityAPI.logAccess(documentId, accessType, confidentiality, method);
  }
}
