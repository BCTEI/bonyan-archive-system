import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  username = '';
  password = '';
  rememberMe = false;
  loading = false;
  hidePassword = true;

  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  constructor() {
    const saved = localStorage.getItem('bonyan_username');
    if (saved) {
      this.username = saved;
      this.rememberMe = true;
    }
  }

  async login(): Promise<void> {
    if (!this.username || !this.password) {
      this.toast.show('يرجى إدخال اسم المستخدم وكلمة المرور', 'warning');
      return;
    }
    this.loading = true;
    const result = await this.auth.login(this.username, this.password);
    this.loading = false;
    if (result.success) {
      if (this.rememberMe) {
        localStorage.setItem('bonyan_username', this.username);
      } else {
        localStorage.removeItem('bonyan_username');
      }
      this.toast.show('تم تسجيل الدخول بنجاح', 'success');
      this.router.navigate(['/main/dashboard']);
    } else {
      this.toast.show(result.message ?? 'فشل تسجيل الدخول', 'error');
    }
  }
}
