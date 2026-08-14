import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ArchivedYear } from '../../models/annual-closing.model';
import { AnnualClosingService } from '../../services/annual-closing.service';
import { DocumentService } from '../../services/document.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-annual-closing',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './annual-closing.component.html',
  styleUrl: './annual-closing.component.scss'
})
export class AnnualClosingComponent implements OnInit {
  private annualClosingService = inject(AnnualClosingService);
  private documentService = inject(DocumentService);
  private toast = inject(ToastService);
  private router = inject(Router);

  currentYear = new Date().getFullYear();
  currentSequence = signal(0);
  documentCount = signal(0);
  archivedYears = signal<ArchivedYear[]>([]);
  loading = signal(false);
  closing = signal(false);
  closingStatus = signal('');
  displayedColumns = ['year', 'archived_at', 'document_count', 'archived_by_name', 'actions'];

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [docs, years, archiveState] = await Promise.all([
        this.documentService.getAll(),
        this.annualClosingService.getArchivedYears(),
        this.annualClosingService.getCurrentArchiveYear()
      ]);
      this.currentYear = archiveState.year;
      this.currentSequence.set(archiveState.sequence);
      const count = docs.filter(d => d.archive_year === this.currentYear).length;
      this.documentCount.set(count);
      this.archivedYears.set(years);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل البيانات';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async closeYear(): Promise<void> {
    if (this.documentCount() === 0) return;

    const confirmed = window.confirm(
      `هل أنت متأكد من إغلاق سنة ${this.currentYear} وبدء سنة ${this.currentYear + 1}؟ لا يمكن التراجع عن هذا الإجراء.`
    );
    if (!confirmed) return;

    this.closing.set(true);
    this.closingStatus.set('جاري عمل نسخة احتياطية...');
    try {
      this.closingStatus.set('جاري أرشفة الوثائق...');
      const result = await this.annualClosingService.closeYear(this.currentYear);
      this.closingStatus.set('جاري إعادة تعيين العدادات...');
      this.toast.show(result.message ?? 'تم إغلاق السنة بنجاح', 'success');
      this.documentCount.set(0);
      await this.loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل إغلاق السنة';
      this.toast.show(message, 'error');
    } finally {
      this.closing.set(false);
      this.closingStatus.set('');
    }
  }

  async viewYear(year: number): Promise<void> {
    await this.router.navigate(['/main/annual-closing', year]);
  }

  async exportYear(year: ArchivedYear): Promise<void> {
    try {
      const docs = await this.annualClosingService.getArchivedDocuments(year.year);
      const header = ['الرقم المرجعي', 'الموضوع', 'التاريخ', 'المرسل', 'المستلم', 'الملاحظات'];
      const lines = docs.map(d => [
        d.ref_number ?? '',
        d.subject ?? '',
        d.date ?? '',
        d.sender ?? '',
        d.receiver ?? '',
        d.notes ?? ''
      ]);
      const csv = [header, ...lines]
        .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archived-${year.year}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.toast.show(`تم تصدير وثائق سنة ${year.year}`, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تصدير الوثائق';
      this.toast.show(message, 'error');
    }
  }

  formatDate(ts?: number | string | null): string {
    if (ts === null || ts === undefined || ts === '') return '-';
    const num = typeof ts === 'number' ? ts : Number(ts);
    if (!isFinite(num)) return '-';
    return new Date(num * 1000).toLocaleDateString('ar-LY');
  }
}
