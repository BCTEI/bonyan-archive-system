import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { StatsCardComponent } from '../stats-card/stats-card.component';
import { DatabaseService } from '../../services/database.service';
import { AuditService } from '../../services/audit.service';
import { DocumentService } from '../../services/document.service';
import { DocumentTypeService } from '../../services/document-type.service';
import { MasterListService } from '../../services/master-list.service';
import { UserService } from '../../services/user.service';
import { PermissionService } from '../../services/permission.service';
import { ToastService } from '../../services/toast.service';
import { AuditEntry } from '../../models/audit-entry.model';
import { ArchiveDocument, DocumentTypeEntry } from '../../models/document.model';
import { MasterListEntry, MasterListType } from '../../models/master-list.model';
import { UserSession } from '../../models/user.model';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule, StatsCardComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit {
  db = inject(DatabaseService);
  auditService = inject(AuditService);
  documentService = inject(DocumentService);
  documentTypeService = inject(DocumentTypeService);
  masterListService = inject(MasterListService);
  userService = inject(UserService);
  permissions = inject(PermissionService);
  toast = inject(ToastService);

  stats = signal<{ total: number; [key: string]: number }>({ total: 0 });
  documentTypes = signal<DocumentTypeEntry[]>([]);
  masterLists = signal<Record<MasterListType, MasterListEntry[]>>({ author: [], sender: [], receiver: [], department: [] });
  recentAudit = signal<AuditEntry[]>([]);
  todaySessions = signal<UserSession[]>([]);
  recentDocuments = signal<ArchiveDocument[]>([]);
  allDocuments = signal<ArchiveDocument[]>([]);
  today = new Date();
  chartDimension = signal<'type' | MasterListType>('type');
  chartDimensions: { value: 'type' | MasterListType; label: string }[] = [
    { value: 'type', label: 'حسب نوع الوثيقة' },
    { value: 'author', label: 'حسب المؤلف' },
    { value: 'sender', label: 'حسب المرسل' },
    { value: 'receiver', label: 'حسب المستلم' },
    { value: 'department', label: 'حسب القسم / الجهة' }
  ];
  private chart?: Chart;

  get rolePermissions() {
    return this.permissions.rolePermissions;
  }

  async ngAfterViewInit(): Promise<void> {
    await this.loadDocumentTypes();
    await this.loadMasterLists();
    await this.loadAllDocuments();
    await this.loadStats();
    await this.loadAudit();
    await this.loadSessions();
    await this.loadRecentDocuments();
    this.renderChart();
  }

  async loadDocumentTypes(): Promise<void> {
    try {
      const types = await this.documentTypeService.getAll(true);
      this.documentTypes.set(types);
    } catch {
      this.documentTypes.set([]);
    }
  }

  async loadMasterLists(): Promise<void> {
    try {
      const [author, sender, receiver, department] = await Promise.all([
        this.masterListService.getAll('author', true),
        this.masterListService.getAll('sender', true),
        this.masterListService.getAll('receiver', true),
        this.masterListService.getAll('department', true)
      ]);
      this.masterLists.set({ author, sender, receiver, department });
    } catch {
      this.masterLists.set({ author: [], sender: [], receiver: [], department: [] });
    }
  }

  async loadAllDocuments(): Promise<void> {
    try {
      const docs = await this.documentService.getAll();
      this.allDocuments.set(docs);
    } catch {
      this.allDocuments.set([]);
    }
  }

  async loadStats(): Promise<void> {
    const s = await this.db.getStats();
    this.stats.set(s);
  }

  async loadAudit(): Promise<void> {
    const entries = await this.auditService.getEntries(5);
    this.recentAudit.set(entries);
  }

  async loadSessions(): Promise<void> {
    try {
      const sessions = await this.userService.getTodaySessions();
      this.todaySessions.set(sessions);
    } catch {
      this.todaySessions.set([]);
    }
  }

  async loadRecentDocuments(): Promise<void> {
    try {
      const docs = await this.documentService.getAll();
      this.recentDocuments.set(docs.slice(0, 5));
    } catch {
      this.recentDocuments.set([]);
    }
  }

  typeStats(): { label: string; value: number; color: string }[] {
    return this.documentTypes().map(t => ({
      label: t.label,
      value: this.stats()[`type_${t.id}`] ?? 0,
      color: t.color
    }));
  }

  chartData(): { label: string; value: number; color: string }[] {
    const dimension = this.chartDimension();
    if (dimension === 'type') {
      return this.documentTypes().map(t => ({
        label: t.label,
        value: this.stats()[`type_${t.id}`] ?? 0,
        color: t.color
      }));
    }

    const docs = this.allDocuments();
    const palette = ['#1e3a5f', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#4b5563', '#65a30d'];
    const counts = new Map<string, number>();
    for (const doc of docs) {
      const raw = dimension === 'department'
        ? (doc.sender || doc.receiver || 'غير محدد')
        : (doc[dimension] || 'غير محدد');
      const key = raw.trim() || 'غير محدد';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return sorted.map(([label, value], i) => ({
      label,
      value,
      color: palette[i % palette.length]
    }));
  }

  setChartDimension(dimension: 'type' | MasterListType): void {
    this.chartDimension.set(dimension);
    this.renderChart();
  }

  renderChart(): void {
    const canvas = document.getElementById('docsChart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dimension = this.chartDimension();
    const items = this.chartData();
    const labels = dimension === 'type' ? ['الكل', ...items.map(t => t.label)] : items.map(t => t.label);
    const data = dimension === 'type' ? [this.stats().total, ...items.map(t => t.value)] : items.map(t => t.value);
    const colors = dimension === 'type' ? ['#1e3a5f', ...items.map(t => t.color)] : items.map(t => t.color);

    this.chart?.destroy();
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'عدد الوثائق',
          data,
          backgroundColor: colors,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, title: { display: true, text: this.chartDimensions.find(d => d.value === dimension)?.label ?? '' } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { ticks: { font: { size: 11 } } }
        }
      }
    });
  }

  formatSessionTime(ts?: number): string {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleTimeString('ar-LY');
  }

  actionClass(action: string): string {
    if (action.includes('حذف')) return 'bg-red-100 text-red-700';
    if (action.includes('إنشاء')) return 'bg-green-100 text-green-700';
    if (action.includes('تعديل')) return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-700';
  }

  async exportData(): Promise<void> {
    try {
      const data = await this.db.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archive-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.toast.show('تم تصدير البيانات', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل التصدير';
      this.toast.show(message, 'error');
    }
  }

  async importData(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await this.db.importData(text, 'merge');
      this.toast.show(result.message, result.success ? 'success' : 'error');
      await this.loadStats();
      await this.loadAllDocuments();
      this.renderChart();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الاستيراد';
      this.toast.show(message, 'error');
    } finally {
      input.value = '';
    }
  }
}
