import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DocumentTypeEntry } from '../../models/document.model';
import { DocumentTypeService } from '../../services/document-type.service';
import { DatabaseService } from '../../services/database.service';
import { ToastService } from '../../services/toast.service';
import { AuditService } from '../../services/audit.service';
import { DocumentTypeFormComponent } from './document-type-form/document-type-form.component';

@Component({
  selector: 'app-document-type-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule
  ],
  templateUrl: './document-type-management.component.html',
  styleUrl: './document-type-management.component.scss'
})
export class DocumentTypeManagementComponent implements OnInit {
  private documentTypeService = inject(DocumentTypeService);
  private db = inject(DatabaseService);
  private toast = inject(ToastService);
  private audit = inject(AuditService);
  private dialog = inject(MatDialog);

  types = signal<DocumentTypeEntry[]>([]);
  documentCounts = signal<Record<number, number>>({});
  search = signal('');
  loading = signal(true);

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [types, counts] = await Promise.all([
        this.documentTypeService.getAll(),
        this.loadDocumentCounts()
      ]);
      this.types.set(types);
      this.documentCounts.set(counts);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل أنواع الوثائق';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadDocumentCounts(): Promise<Record<number, number>> {
    try {
      const rows = await this.db.query<{ type_id: number; c: number }>(
        'SELECT type_id, COUNT(*) as c FROM documents GROUP BY type_id'
      );
      const counts: Record<number, number> = {};
      for (const row of rows) {
        counts[row.type_id] = row.c;
      }
      return counts;
    } catch {
      return {};
    }
  }

  filteredTypes(): DocumentTypeEntry[] {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.types();
    return this.types().filter(t =>
      t.name.toLowerCase().includes(term) ||
      t.label.toLowerCase().includes(term) ||
      t.prefix.toLowerCase().includes(term)
    );
  }

  openForm(type?: DocumentTypeEntry): void {
    const ref = this.dialog.open(DocumentTypeFormComponent, {
      width: '520px',
      maxWidth: '95vw',
      data: { type, types: this.types() }
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadData();
    });
  }

  async deleteType(type: DocumentTypeEntry): Promise<void> {
    if (!type.id) return;

    if (type.is_system === 1) {
      this.toast.show('لا يمكن حذف نوع وثيقة نظامي', 'warning');
      return;
    }

    const count = this.documentCounts()[type.id] ?? 0;
    if (count > 0) {
      this.toast.show('لا يمكن حذف نوع يحتوي على وثائق', 'warning');
      return;
    }

    if (!confirm(`هل أنت متأكد من حذف نوع الوثيقة "${type.label}"؟`)) return;

    try {
      await this.documentTypeService.delete(type.id);
      this.toast.show('تم حذف نوع الوثيقة بنجاح', 'success');
      await this.audit.log('حذف نوع وثيقة', type.prefix, `الاسم: ${type.label}`);
      await this.loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل حذف نوع الوثيقة';
      this.toast.show(message, 'error');
    }
  }

  isSystem(type: DocumentTypeEntry): boolean {
    return type.is_system === 1;
  }

  documentCount(type: DocumentTypeEntry): number {
    return type.id ? (this.documentCounts()[type.id] ?? 0) : 0;
  }

  iconBackground(color: string): string {
    return `${color}20`;
  }

  sampleRef(prefix: string): string {
    return `${prefix}-XXX-YYYY-ZZZZ`;
  }
}
