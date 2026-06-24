import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { User, ROLE_LABELS, UserRole } from '../../models/user.model';
import { PasswordResetRequest } from '../../models/password-reset.model';
import { UserService } from '../../services/user.service';
import { PasswordResetService } from '../../services/password-reset.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { UserFormComponent } from './user-form/user-form.component';
import { UserSessionsComponent } from './user-sessions/user-sessions.component';
import { FolderPermissionsComponent } from '../folder-permissions/folder-permissions.component';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatPaginatorModule,
    MatMenuModule,
    MatTabsModule
  ],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss'
})
export class UserManagementComponent implements OnInit {
  private userService = inject(UserService);
  private passwordResetService = inject(PasswordResetService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  users = signal<User[]>([]);
  filtered = signal<User[]>([]);
  pendingRequests = signal<PasswordResetRequest[]>([]);
  search = signal('');
  roleFilter = signal<'all' | UserRole>('all');
  statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  loading = signal(true);
  requestsLoading = signal(false);

  pageSize = signal(10);
  pageIndex = signal(0);
  displayedColumns = ['id', 'username', 'full_name', 'role', 'is_active', 'created_at', 'actions'];
  requestColumns = ['username', 'request_date', 'status', 'actions'];
  roleLabels: Record<string, string> = ROLE_LABELS;

  adminCount = 0;
  editorCount = 0;
  viewerCount = 0;

  async ngOnInit(): Promise<void> {
    await this.loadUsers();
    await this.loadPendingRequests();
  }

  async loadUsers(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.userService.getAll();
      this.users.set(list);
      this.updateCounts();
      this.applyFilters();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل المستخدمين';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async loadPendingRequests(): Promise<void> {
    this.requestsLoading.set(true);
    try {
      const list = await this.passwordResetService.getPendingRequests();
      this.pendingRequests.set(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل طلبات إعادة التعيين';
      this.toast.show(message, 'error');
    } finally {
      this.requestsLoading.set(false);
    }
  }

  private updateCounts(): void {
    this.adminCount = this.users().filter(u => u.role === 'admin').length;
    this.editorCount = this.users().filter(u => u.role === 'editor').length;
    this.viewerCount = this.users().filter(u => u.role === 'viewer').length;
  }

  applyFilters(): void {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const role = this.roleFilter();
    let list = this.users().filter(u =>
      u.username.toLowerCase().includes(term) ||
      (u.full_name ?? '').toLowerCase().includes(term)
    );
    if (status === 'active') list = list.filter(u => u.is_active);
    if (status === 'inactive') list = list.filter(u => !u.is_active);
    if (role !== 'all') list = list.filter(u => u.role === role);
    this.filtered.set(list);
    this.pageIndex.set(0);
  }

  paginatedUsers(): User[] {
    const start = this.pageIndex() * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  }

  onPage(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  openForm(user?: User): void {
    const ref = this.dialog.open(UserFormComponent, {
      width: '480px',
      maxWidth: '95vw',
      data: { user }
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadUsers();
    });
  }

  async toggleStatus(user: User): Promise<void> {
    if (!user.id) return;
    try {
      await this.userService.toggleStatus(user.id, !user.is_active);
      this.toast.show(`تم ${user.is_active ? 'تعطيل' : 'تفعيل'} المستخدم بنجاح`, 'success');
      await this.loadUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تغيير الحالة';
      this.toast.show(message, 'error');
    }
  }

  async deleteUser(user: User): Promise<void> {
    if (!user.id) return;
    if (!confirm(`هل أنت متأكد من حذف المستخدم "${user.username}"؟`)) return;
    try {
      await this.userService.delete(user.id);
      this.toast.show('تم حذف المستخدم بنجاح', 'success');
      await this.loadUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل حذف المستخدم';
      this.toast.show(message, 'error');
    }
  }

  async resetPassword(user: User): Promise<void> {
    if (!user.id) return;
    const newPassword = prompt(`أدخل كلمة المرور الجديدة للمستخدم "${user.username}" (6 أحرف على الأقل):`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      this.toast.show('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'warning');
      return;
    }
    try {
      await this.passwordResetService.adminReset(user.id, newPassword);
      this.toast.show('تم إعادة تعيين كلمة المرور بنجاح', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل إعادة التعيين';
      this.toast.show(message, 'error');
    }
  }

  async approveReset(req: PasswordResetRequest): Promise<void> {
    if (!req.id) return;
    const newPassword = prompt(`أدخل كلمة المرور الجديدة للمستخدم "${req.username}" (6 أحرف على الأقل):`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      this.toast.show('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'warning');
      return;
    }
    try {
      await this.passwordResetService.approveRequest(req.id, newPassword);
      this.toast.show('تمت الموافقة وإعادة تعيين كلمة المرور', 'success');
      await this.loadPendingRequests();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الموافقة';
      this.toast.show(message, 'error');
    }
  }

  async rejectReset(req: PasswordResetRequest): Promise<void> {
    if (!req.id) return;
    if (!confirm(`هل أنت متأكد من رفض طلب المستخدم "${req.username}"؟`)) return;
    try {
      await this.passwordResetService.rejectRequest(req.id);
      this.toast.show('تم رفض الطلب', 'success');
      await this.loadPendingRequests();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الرفض';
      this.toast.show(message, 'error');
    }
  }

  openSessions(user: User): void {
    if (!user.id) return;
    this.dialog.open(UserSessionsComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { userId: user.id, username: user.username }
    });
  }

  openPermissions(user: User): void {
    if (!user.id) return;
    const ref = this.dialog.open(FolderPermissionsComponent, {
      width: '720px',
      maxWidth: '95vw',
      data: { user }
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadUsers();
    });
  }

  formatDate(ts?: number | string | null): string {
    if (ts === null || ts === undefined || ts === '') return '-';
    const num = typeof ts === 'number' ? ts : Number(ts);
    if (!isFinite(num)) return '-';
    return new Date(num * 1000).toLocaleDateString('ar-LY');
  }

  roleClass(role: string): string {
    return `role-${role}`;
  }

  canManage(): boolean {
    return this.auth.isAdmin();
  }
}
