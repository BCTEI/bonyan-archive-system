import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { PasswordResetService } from '../../services/password-reset.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.scss'
})
export class ChangePasswordComponent {
  private passwordService = inject(PasswordResetService);
  private toast = inject(ToastService);

  currentPassword = signal('');
  newPassword = signal('');
  confirmPassword = signal('');
  hideCurrent = signal(true);
  hideNew = signal(true);
  hideConfirm = signal(true);
  loading = signal(false);
  errors = signal<Record<string, string>>({});

  async submit(): Promise<void> {
    this.errors.set({});

    if (this.newPassword().length < 6) {
      this.errors.set({ newPassword: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
      return;
    }

    if (this.newPassword() !== this.confirmPassword()) {
      this.errors.set({ confirmPassword: 'كلمات المرور غير متطابقة' });
      return;
    }

    this.loading.set(true);
    try {
      await this.passwordService.changeOwnPassword(this.currentPassword(), this.newPassword());
      this.toast.show('تم تغيير كلمة المرور بنجاح', 'success');
      this.currentPassword.set('');
      this.newPassword.set('');
      this.confirmPassword.set('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تغيير كلمة المرور';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }
}
