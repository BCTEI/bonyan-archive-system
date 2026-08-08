import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { PasswordResetRequestComponent } from '../password-reset-request/password-reset-request.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatDialogModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  username = '';
  password = '';
  rememberMe = false;
  loading = false;
  hidePassword = true;
  errorMessage: string | null = null;

  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  constructor() {
    const saved = localStorage.getItem('bonyan_username');
    if (saved) {
      this.username = saved;
      this.rememberMe = true;
    }
  }

  async login(): Promise<void> {
    this.errorMessage = null;

    if (!this.username || !this.password) {
      this.errorMessage = 'يرجى إدخال اسم المستخدم وكلمة المرور';
      this.toast.show(this.errorMessage, 'warning');
      return;
    }

    this.loading = true;
    try {
      const result = await this.auth.login(this.username, this.password);
      if (result.success) {
        if (this.rememberMe) {
          localStorage.setItem('bonyan_username', this.username);
        } else {
          localStorage.removeItem('bonyan_username');
        }
        this.toast.show('تم تسجيل الدخول بنجاح', 'success');
        await this.router.navigate(['/main/dashboard']);
      } else {
        this.errorMessage = result.message ?? 'فشل تسجيل الدخول';
        this.toast.show(this.errorMessage, 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطأ غير متوقع أثناء تسجيل الدخول';
      console.error('[Login Component] Login error:', err);
      this.errorMessage = msg;
      this.toast.show(msg, 'error');
    } finally {
      this.loading = false;
    }
  }

  showForgotPassword(): void {
    this.dialog.open(PasswordResetRequestComponent, { width: '420px', maxWidth: '95vw' });
  }
}
