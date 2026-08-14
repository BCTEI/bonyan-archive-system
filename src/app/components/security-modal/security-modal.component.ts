import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ArchiveDocument } from '../../models/document.model';
import { SecurityService } from '../../services/security.service';
import { AuthService } from '../../services/auth.service';
import { DocumentAction } from '../../services/document-access.service';

interface SecurityModalData {
  doc: ArchiveDocument;
  action: DocumentAction;
}

const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

@Component({
  selector: 'app-security-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './security-modal.component.html',
  styleUrl: './security-modal.component.scss'
})
export class SecurityModalComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<SecurityModalComponent, { verified: true; method: string }>);
  private data = inject<SecurityModalData>(MAT_DIALOG_DATA);
  private securityService = inject(SecurityService);
  private authService = inject(AuthService);

  doc = this.data.doc;
  action = this.data.action;

  step = signal<'password' | 'code'>('password');
  password = signal('');
  code = signal('');
  loading = signal(false);
  errorMessage = signal('');
  locked = signal(false);
  hidePassword = signal(true);

  private failedAttempts = 0;
  private firstFailureTime: number | null = null;

  get actionTitle(): string {
    switch (this.action) {
      case 'edit': return 'تعديل الوثيقة';
      case 'print': return 'طباعة الوثيقة';
      case 'delete': return 'حذف الوثيقة';
      case 'view': return 'عرض الوثيقة';
      default: return 'الوصول إلى الوثيقة';
    }
  }

  get actionIcon(): string {
    switch (this.action) {
      case 'edit': return '✏️';
      case 'print': return '🖨️';
      case 'delete': return '🗑️';
      case 'view': return '👁️';
      default: return '🔐';
    }
  }

  async ngOnInit(): Promise<void> {
    if (this.doc.confidentiality === 'عادي') {
      this.dialogRef.close({ verified: true, method: 'none' });
      return;
    }

    const user = this.authService.currentUser();
    if (!user) {
      this.errorMessage.set('لم يتم تسجيل الدخول');
    }
  }

  async verifyPassword(): Promise<void> {
    if (this.locked()) return;

    const pwd = this.password().trim();
    if (!pwd) {
      this.errorMessage.set('يرجى إدخال كلمة المرور');
      return;
    }

    const user = this.authService.currentUser();
    if (!user) {
      this.errorMessage.set('لم يتم تسجيل الدخول');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const valid = await this.securityService.verifyPassword(user.username, pwd);
      if (valid) {
        this.failedAttempts = 0;
        this.firstFailureTime = null;

        if (this.doc.confidentiality === 'سري للغاية') {
          this.step.set('code');
          this.password.set('');
        } else {
          await this.logAccess('password');
          this.dialogRef.close({ verified: true, method: 'password' });
        }
      } else {
        this.handleFailedAttempt('كلمة المرور غير صحيحة');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل التحقق من كلمة المرور';
      this.errorMessage.set(message);
    } finally {
      this.loading.set(false);
    }
  }

  async verifyCode(): Promise<void> {
    const codeValue = this.code().trim();
    if (!/^\d{6}$/.test(codeValue)) {
      this.errorMessage.set('يرجى إدخال رمز تحقق مكون من 6 أرقام');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const valid = await this.securityService.verifyCode(codeValue);
      if (valid) {
        await this.logAccess('password+code');
        this.dialogRef.close({ verified: true, method: 'password+code' });
      } else {
        this.errorMessage.set('رمز التحقق غير صحيح');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل التحقق من الرمز';
      this.errorMessage.set(message);
    } finally {
      this.loading.set(false);
    }
  }

  private async logAccess(method: string): Promise<void> {
    const accessType = this.normalizeAccessType(this.action);
    await this.securityService.logAccess(this.doc.id!, accessType, this.doc.confidentiality, method);
  }

  private normalizeAccessType(action: DocumentAction): 'view' | 'edit' {
    // The database access log only supports 'view' and 'edit'.
    // Map print/delete to 'edit' since they are modification-type actions.
    return action === 'view' ? 'view' : 'edit';
  }

  private handleFailedAttempt(message: string): void {
    const now = Date.now();

    if (this.firstFailureTime === null || now - this.firstFailureTime > LOCKOUT_DURATION_MS) {
      this.failedAttempts = 1;
      this.firstFailureTime = now;
      this.errorMessage.set(message);
      return;
    }

    this.failedAttempts += 1;

    if (this.failedAttempts >= MAX_ATTEMPTS) {
      this.locked.set(true);
      this.errorMessage.set('تم تأمين الوصول لمدة 5 دقائق');
      setTimeout(() => {
        this.locked.set(false);
        this.failedAttempts = 0;
        this.firstFailureTime = null;
        this.errorMessage.set('');
      }, LOCKOUT_DURATION_MS);
    } else {
      this.errorMessage.set(message);
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}