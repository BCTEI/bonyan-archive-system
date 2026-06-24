import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { VerificationCode } from '../../models/security.model';
import { SecurityService } from '../../services/security.service';
import { AuditService } from '../../services/audit.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-security-center',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './security-center.component.html',
  styleUrl: './security-center.component.scss'
})
export class SecurityCenterComponent implements OnInit {
  private securityService = inject(SecurityService);
  private auditService = inject(AuditService);
  private toast = inject(ToastService);

  currentCode = signal<VerificationCode | null>(null);
  loading = signal(false);
  generating = signal(false);

  generatedCode = signal<string | null>(null);
  generatedExpiry = signal<number | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadCurrentCode();
  }

  async loadCurrentCode(): Promise<void> {
    this.loading.set(true);
    try {
      const code = await this.securityService.getCurrentCode();
      this.currentCode.set(code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل الرمز الحالي';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async generateCode(): Promise<void> {
    this.generating.set(true);
    this.generatedCode.set(null);
    this.generatedExpiry.set(null);

    try {
      const result = await this.securityService.generateCode();
      this.generatedCode.set(result.code);
      this.generatedExpiry.set(result.expiresAt);
      this.currentCode.set({
        code: result.code,
        expires_at: result.expiresAt,
        is_active: 1
      });

      await this.auditService.log('توليد رمز تحقق');
      this.toast.show('تم توليد رمز التحقق بنجاح', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل توليد الرمز';
      this.toast.show(message, 'error');
    } finally {
      this.generating.set(false);
    }
  }

  async copyCode(): Promise<void> {
    const code = this.generatedCode();
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      this.toast.show('تم نسخ الرمز', 'success');
    } catch {
      this.toast.show('فشل نسخ الرمز', 'error');
    }
  }

  formatExpiry(timestamp: number | null | undefined): string {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
