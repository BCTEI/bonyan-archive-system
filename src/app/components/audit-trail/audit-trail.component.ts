import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { AuditEntry } from '../../models/audit-entry.model';

@Component({
  selector: 'app-audit-trail',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule],
  templateUrl: './audit-trail.component.html',
  styleUrl: './audit-trail.component.scss'
})
export class AuditTrailComponent implements OnInit {
  private auditService = inject(AuditService);
  auth = inject(AuthService);
  private toast = inject(ToastService);

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
    if (!this.auth.isAdmin()) {
      this.toast.show('غير مسموح', 'error');
      return;
    }
    const username = this.auth.currentUser()?.username ?? '';
    const password = prompt('أدخل كلمة المرور لتأكيد مسح السجل');
    if (!password) return;
    const valid = await window.electronAPI.verifyPassword(username, password);
    if (!valid) {
      this.toast.show('كلمة المرور غير صحيحة', 'error');
      return;
    }
    await this.auditService.clearAll();
    await this.load();
    this.toast.show('تم مسح السجل', 'success');
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
