import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { User, UserRole, ROLE_LABELS } from '../../../models/user.model';
import { UserService } from '../../../services/user.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule
  ],
  templateUrl: './user-form.component.html',
  styleUrl: './user-form.component.scss'
})
export class UserFormComponent {
  private dialogRef = inject(MatDialogRef<UserFormComponent>);
  private data = inject<{ user?: User }>(MAT_DIALOG_DATA);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  isEdit = !!this.data.user;
  user = this.data.user;

  username = signal(this.user?.username ?? '');
  fullName = signal(this.user?.full_name ?? '');
  password = signal('');
  confirmPassword = signal('');
  role = signal<UserRole>(this.user?.role ?? 'viewer');
  isActive = signal(this.user?.is_active ?? true);

  roles: { value: UserRole; label: string }[] = [
    { value: 'admin', label: ROLE_LABELS.admin },
    { value: 'editor', label: ROLE_LABELS.editor },
    { value: 'viewer', label: ROLE_LABELS.viewer }
  ];

  loading = signal(false);
  errors = signal<Record<string, string>>({});

  async save(): Promise<void> {
    this.errors.set({});
    const payload: any = {
      username: this.username().trim(),
      full_name: this.fullName().trim() || null,
      role: this.role(),
      is_active: this.isActive()
    };

    if (this.password()) {
      payload.password = this.password();
      payload.confirmPassword = this.confirmPassword();
    }

    try {
      this.loading.set(true);
      if (this.isEdit && this.user?.id) {
        await this.userService.update(this.user.id, payload);
        this.toast.show('تم تحديث المستخدم بنجاح', 'success');
      } else {
        await this.userService.create(payload);
        this.toast.show('تم إنشاء المستخدم بنجاح', 'success');
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ غير معروف';
      this.toast.show(message, 'error');
      this.parseErrors(message);
    } finally {
      this.loading.set(false);
    }
  }

  private parseErrors(message: string): void {
    const map: Record<string, string> = {};
    if (message.includes('اسم المستخدم')) map['username'] = message;
    if (message.includes('كلمة المرور')) map['password'] = message;
    if (message.includes('الصلاحية')) map['role'] = message;
    this.errors.set(map);
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
