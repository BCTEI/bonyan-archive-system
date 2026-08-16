import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { CODE_STATUS_LABELS, CodeStatus, UserCodeEntry } from '../../models/security.model';
import { User } from '../../models/user.model';
import { SecurityService } from '../../services/security.service';
import { UserService } from '../../services/user.service';
import { ToastService } from '../../services/toast.service';
import { CodeIssuedDialogComponent } from './code-issued-dialog/code-issued-dialog.component';
import { formatDateTime } from '../../utils/format-date.util';

@Component({
  selector: 'app-security-center',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule
  ],
  templateUrl: './security-center.component.html',
  styleUrl: './security-center.component.scss'
})
export class SecurityCenterComponent implements OnInit {
  private securityService = inject(SecurityService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  codes = signal<UserCodeEntry[]>([]);
  users = signal<User[]>([]);
  selectedUserId = signal<number | null>(null);

  loading = signal(false);
  usersLoading = signal(false);
  generating = signal(false);

  displayedColumns = ['username', 'status', 'generated_at', 'expires_at', 'generated_by_name', 'actions'];
  statusLabels: Record<string, string> = CODE_STATUS_LABELS;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadCodes(), this.loadUsers()]);
  }

  async loadCodes(): Promise<void> {
    this.loading.set(true);
    try {
      this.codes.set(await this.securityService.listCodes());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل الرموز الصادرة';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async loadUsers(): Promise<void> {
    this.usersLoading.set(true);
    try {
      // Security Center is already admin-tier gated (adminGuard on the /security
      // route, mirrored server-side by hasMinRole(user, 'deputy_manager') on every
      // security:* handler) so the full user list is appropriate here.
      this.users.set(await this.userService.getAll());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل المستخدمين';
      this.toast.show(message, 'error');
    } finally {
      this.usersLoading.set(false);
    }
  }

  async generateCode(): Promise<void> {
    const userId = this.selectedUserId();
    if (!userId) {
      this.toast.show('يرجى اختيار المستخدم أولاً', 'warning');
      return;
    }
    const target = this.users().find(u => u.id === userId);

    this.generating.set(true);
    try {
      const result = await this.securityService.generateCode(userId);

      // Shown exactly once — the code is never written back into `codes`/the
      // issued-codes table, only this session-local dialog ever displays it.
      this.dialog.open(CodeIssuedDialogComponent, {
        width: '480px',
        maxWidth: '95vw',
        disableClose: true,
        data: { username: target?.username ?? '', code: result.code, expiresAt: result.expiresAt }
      });

      this.toast.show('تم توليد رمز التحقق بنجاح', 'success');
      await this.loadCodes();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل توليد الرمز';
      this.toast.show(message, 'error');
    } finally {
      this.generating.set(false);
    }
  }

  async revoke(entry: UserCodeEntry): Promise<void> {
    if (!confirm(`هل أنت متأكد من إلغاء رمز المستخدم "${entry.username}"؟`)) return;
    try {
      await this.securityService.revokeCode(entry.id);
      this.toast.show('تم إلغاء الرمز', 'success');
      await this.loadCodes();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل إلغاء الرمز';
      this.toast.show(message, 'error');
    }
  }

  statusClass(status: CodeStatus): string {
    switch (status) {
      case 'active': return 'bg-success/10 text-success';
      case 'used': return 'bg-secondary text-text-light';
      case 'revoked': return 'bg-danger/10 text-danger';
      case 'expired': return 'bg-warning/10 text-warning';
      default: return 'bg-secondary text-text';
    }
  }

  formatDate = formatDateTime;
}
