import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { AuditEntry } from '../../models/audit-entry.model';
import { HasPermissionDirective } from '../../directives/has-permission.directive';
import { PasswordConfirmDialogComponent } from '../dialogs/password-confirm-dialog/password-confirm-dialog.component';
import { FinalConfirmDialogComponent } from '../dialogs/final-confirm-dialog/final-confirm-dialog.component';

@Component({
  selector: 'app-audit-trail',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatDialogModule, HasPermissionDirective],
  templateUrl: './audit-trail.component.html',
  styleUrl: './audit-trail.component.scss'
})
export class AuditTrailComponent implements OnInit {
  private auditService = inject(AuditService);
  auth = inject(AuthService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  entries = signal<AuditEntry[]>([]);
  filter = signal('');
  displayedColumns = ['timestamp', 'action', 'doc_ref', 'details', 'username'];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.entries.set(await this.auditService.getEntries());
  }

  filteredEntries(): AuditEntry[] {
    const term = this.filter().trim();
    if (!term) return this.entries();
    return this.entries().filter(e =>
      e.action.includes(term) ||
      (e.doc_ref?.includes(term) ?? false) ||
      (e.details?.includes(term) ?? false) ||
      (e.username?.includes(term) ?? false)
    );
  }

  actionClass(action: string): string {
    if (action.includes('حذف')) return 'bg-danger text-white';
    if (action.includes('إنشاء')) return 'bg-success text-white';
    if (action.includes('تعديل')) return 'bg-warning text-white';
    if (action.includes('عرض')) return 'bg-info text-white';
    return 'bg-secondary text-text';
  }

  async clearAll(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user?.username) {
      this.toast.show('غير مسموح', 'error');
      return;
    }

    const password = await this.showPasswordDialog('أدخل كلمة المرور لمسح سجل التدقيق');
    if (!password) return;

    const verified = await window.electronAPI.verifyPassword(user.username, password);
    if (!verified) {
      this.toast.show('❌ كلمة المرور غير صحيحة', 'error');
      return;
    }

    const confirmed = await this.showFinalConfirmationDialog(
      'مسح سجل التدقيق',
      'هل أنت متأكد من مسح سجل التدقيق؟',
      'لا يمكنك التراجع عن هذا القرار! سيتم حذف جميع سجلات التدقيق نهائياً.',
      'نعم، مسح السجل'
    );
    if (!confirmed) return;

    try {
      const result = await this.auditService.clearAll();
      if (!result.success) {
        this.toast.show('❌ خطأ: ' + result.error, 'error');
        return;
      }

      this.entries.set([]);
      this.toast.show('✅ تم مسح سجل التدقيق بنجاح', 'success');

      await this.auditService.log(
        'مسح سجل',
        'ALL',
        `تم مسح سجل التدقيق بالكامل من قبل ${user.username}`
      );
      await this.load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ في الاتصال بالنظام';
      this.toast.show('❌ ' + message, 'error');
    }
  }

  private showPasswordDialog(message: string): Promise<string | null> {
    return new Promise(resolve => {
      const ref = this.dialog.open(PasswordConfirmDialogComponent, {
        data: { message },
        disableClose: true,
        width: '420px',
        maxWidth: '95vw'
      });
      ref.afterClosed().subscribe(result => resolve(result));
    });
  }

  private showFinalConfirmationDialog(title: string, message: string, warning: string, confirmText?: string): Promise<boolean> {
    return new Promise(resolve => {
      const ref = this.dialog.open(FinalConfirmDialogComponent, {
        data: { title, message, warning, confirmText },
        disableClose: true,
        width: '480px',
        maxWidth: '95vw'
      });
      ref.afterClosed().subscribe(result => resolve(!!result));
    });
  }

  exportCsv(): void {
    const rows = this.filteredEntries();
    const header = ['الوقت', 'الإجراء', 'الوثيقة', 'التفاصيل', 'المستخدم'];
    const lines = rows.map(e => [
      e.timestamp ?? '',
      e.action,
      e.doc_ref ?? '',
      e.details ?? '',
      e.username ?? ''
    ]);
    const csv = [header, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
