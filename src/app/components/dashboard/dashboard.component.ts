import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { StatsCardComponent } from '../stats-card/stats-card.component';
import { DatabaseService } from '../../services/database.service';
import { AuditService } from '../../services/audit.service';
import { AuditEntry } from '../../models/audit-entry.model';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, MatCardModule, StatsCardComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit {
  db = inject(DatabaseService);
  auditService = inject(AuditService);

  stats = signal({ total: 0, outgoing: 0, incoming: 0, correspondence: 0 });
  recentAudit = signal<AuditEntry[]>([]);
  private chart?: Chart;

  async ngAfterViewInit(): Promise<void> {
    await this.loadStats();
    await this.loadAudit();
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
}
