import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { StatsCardComponent } from '../stats-card/stats-card.component';
import { DatabaseService } from '../../services/database.service';
import { AuditService } from '../../services/audit.service';
import { DocumentService } from '../../services/document.service';
import { UserService } from '../../services/user.service';
import { PermissionService } from '../../services/permission.service';
import { ToastService } from '../../services/toast.service';
import { AuditEntry } from '../../models/audit-entry.model';
import { ArchiveDocument } from '../../models/document.model';
import { UserSession } from '../../models/user.model';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatButtonModule, MatIconModule, StatsCardComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit {
  db = inject(DatabaseService);
  auditService = inject(AuditService);
  documentService = inject(DocumentService);
  userService = inject(UserService);
  permissions = inject(PermissionService);
  toast = inject(ToastService);

  stats = signal({ total: 0, outgoing: 0, incoming: 0, correspondence: 0 });
  recentAudit = signal<AuditEntry[]>([]);
  todaySessions = signal<UserSession[]>([]);
  recentDocuments = signal<ArchiveDocument[]>([]);
  today = new Date();
  private chart?: Chart;

  get rolePermissions() {
    return this.permissions.rolePermissions;
  }

  async ngAfterViewInit(): Promise<void> {
    await this.loadStats();
    await this.loadAudit();
    await this.loadSessions();
    await this.loadRecentDocuments();
    this.renderChart();
  }

  async loadStats(): Promise<void> {
    const s = await this.db.getStats();
    this.stats.set({
      total: s.total,
      outgoing: s['صادر'],
      incoming: s['وارد'],
      correspondence: s['مراسلات']
    });
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

  renderChart(): void {
    const canvas = document.getElementById('docsChart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.chart?.destroy();
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['الكل', 'صادر', 'وارد', 'مراسلات'],
        datasets: [{
          label: 'عدد الوثائق',
          data: [this.stats().total, this.stats().outgoing, this.stats().incoming, this.stats().correspondence],
          backgroundColor: ['#1e3a5f', '#059669', '#d97706', '#2563eb'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
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
      this.renderChart();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الاستيراد';
      this.toast.show(message, 'error');
    } finally {
      input.value = '';
    }
  }
}
