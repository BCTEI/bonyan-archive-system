import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DocumentCardComponent } from '../document-card/document-card.component';
import { DocumentFormComponent } from '../document-form/document-form.component';
import { DocumentViewComponent } from '../document-view/document-view.component';
import { DocumentService } from '../../services/document.service';
import { FolderService } from '../../services/folder.service';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { ExportImportService } from '../../services/export-import.service';
import { ToastService } from '../../services/toast.service';
import { ArchiveDocument, DocumentType } from '../../models/document.model';
import { Folder } from '../../models/folder.model';

@Component({
  selector: 'app-document-grid',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, DocumentCardComponent
  ],
  templateUrl: './document-grid.component.html',
  styleUrl: './document-grid.component.scss'
})
export class DocumentGridComponent implements OnInit {
  private documentService = inject(DocumentService);
  private folderService = inject(FolderService);
  private auditService = inject(AuditService);
  auth = inject(AuthService);
  private exportImport = inject(ExportImportService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);

  documents = signal<ArchiveDocument[]>([]);
  folders = signal<Folder[]>([]);
  filtered = signal<ArchiveDocument[]>([]);
  types: DocumentType[] = ['صادر', 'وارد', 'مراسلات'];
  selectedType = signal<DocumentType | 'الكل'>('الكل');
  selectedFolder = signal<number | 'الكل'>('الكل');
  search = signal('');
  loading = signal(false);

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    await this.loadData();
    this.route.queryParams.subscribe(params => {
      if (params['folder']) {
        this.selectedFolder.set(Number(params['folder']));
      }
      if (params['q']) {
        this.search.set(params['q']);
      }
      this.applyFilters();
    });
    this.loading.set(false);
  }

  async loadData(): Promise<void> {
    const [docs, fldrs] = await Promise.all([this.documentService.getAll(), this.folderService.getAll()]);
    this.documents.set(docs);
    this.folders.set(fldrs);
    this.applyFilters();
  }

  applyFilters(): void {
    let list = this.documents();
    const type = this.selectedType();
    const folder = this.selectedFolder();
    const term = this.search().trim();

    if (type !== 'الكل') {
      list = list.filter(d => d.type === type);
    }
    if (folder !== 'الكل') {
      list = list.filter(d => d.folder_id === folder);
    }
    if (term) {
      list = list.filter(d =>
        d.subject.includes(term) ||
        d.ref_number.includes(term) ||
        (d.sender?.includes(term) ?? false) ||
        (d.receiver?.includes(term) ?? false)
      );
    }
    this.filtered.set(list);
  }

  setType(type: DocumentType | 'الكل'): void {
    this.selectedType.set(type);
    this.applyFilters();
  }

  setFolder(folderId: number | 'الكل'): void {
    this.selectedFolder.set(folderId);
    this.applyFilters();
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.applyFilters();
  }

  folderName(folderId: number): string {
    return this.folders().find(f => f.id === folderId)?.name ?? '';
  }

  openNew(): void {
    const ref = this.dialog.open(DocumentFormComponent, { width: '900px', maxWidth: '95vw', disableClose: true });
    ref.afterClosed().subscribe(async result => {
      if (result) {
        await this.loadData();
        this.toast.show('تم حفظ الوثيقة بنجاح', 'success');
      }
    });
  }

  onView(doc: ArchiveDocument): void {
    this.dialog.open(DocumentViewComponent, {
      width: '850px',
      maxWidth: '95vw',
      data: { doc, folder: this.folders().find(f => f.id === doc.folder_id) }
    });
  }

  onEdit(doc: ArchiveDocument): void {
    const ref = this.dialog.open(DocumentFormComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true,
      data: { doc }
    });
    ref.afterClosed().subscribe(async result => {
      if (result) {
        await this.loadData();
        this.toast.show('تم تحديث الوثيقة بنجاح', 'success');
      }
    });
  }

  async onDelete(doc: ArchiveDocument): Promise<void> {
    if (!confirm('هل أنت متأكد من حذف الوثيقة؟')) return;
    await this.documentService.delete(doc.id!);
    await this.auditService.log('حذف', doc.ref_number, doc.subject);
    await this.loadData();
    this.toast.show('تم حذف الوثيقة', 'success');
  }

  onPrint(doc: ArchiveDocument): void {
    this.dialog.open(DocumentViewComponent, {
      width: '850px',
      maxWidth: '95vw',
      data: { doc, folder: this.folders().find(f => f.id === doc.folder_id), print: true }
    });
  }

  async exportData(): Promise<void> {
    await this.exportImport.exportToFile();
    this.toast.show('تم تصدير البيانات', 'success');
  }

  async onImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const mode = confirm('هل تريد استبدال البيانات الحالية؟ اضغط "موافق" للاستبدال أو "إلغاء" للدمج.')
      ? 'replace'
      : 'merge';

    try {
      const json = await this.exportImport.readFile(file);
      const result = await this.exportImport.importFromJson(json, mode);
      if (result.success) {
        await this.loadData();
        this.toast.show(result.message, 'success');
      } else {
        this.toast.show(result.message, 'error');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الاستيراد';
      this.toast.show(message, 'error');
    }
  }
}
