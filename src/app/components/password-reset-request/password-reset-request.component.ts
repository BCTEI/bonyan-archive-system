import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { PasswordResetService } from '../../services/password-reset.service';

@Component({
  selector: 'app-password-reset-request',
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
  templateUrl: './password-reset-request.component.html'
})
export class PasswordResetRequestComponent {
  private passwordService = inject(PasswordResetService);
  private dialogRef = inject(MatDialogRef<PasswordResetRequestComponent>);

  username = signal('');
  loading = signal(false);
  message = signal<string | null>(null);
  success = signal(false);

  async submit(): Promise<void> {
    if (!this.username().trim()) {
      this.message.set('يرجى إدخال اسم المستخدم');
      this.success.set(false);
      return;
    }

    this.loading.set(true);
    this.message.set(null);
    try {
      await this.passwordService.requestReset(this.username().trim());
      this.message.set('تم إرسال طلب إعادة تعيين كلمة المرور بنجاح');
      this.success.set(true);
      setTimeout(() => this.dialogRef.close(true), 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل إرسال الطلب';
      this.message.set(msg);
      this.success.set(false);
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
