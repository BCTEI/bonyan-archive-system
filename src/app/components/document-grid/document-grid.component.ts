import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DocumentCardComponent } from '../document-card/document-card.component';
import { HasPermissionDirective } from '../../directives/has-permission.directive';
import { DocumentFormComponent } from '../document-form/document-form.component';
import { DocumentViewComponent } from '../document-view/document-view.component';
import { DocumentAccessService } from '../../services/document-access.service';
import { DocumentService } from '../../services/document.service';
import { DocumentTypeService } from '../../services/document-type.service';
import { FolderService } from '../../services/folder.service';
import { MasterListService } from '../../services/master-list.service';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { ExportImportService } from '../../services/export-import.service';
import { ToastService } from '../../services/toast.service';
import { ArchiveDocument, DocumentTypeEntry, ConfidentialityLevel } from '../../models/document.model';
import { Folder } from '../../models/folder.model';

@Component({
  selector: 'app-document-grid',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    DocumentCardComponent, HasPermissionDirective
  ],
  templateUrl: './document-grid.component.html',
  styleUrl: './document-grid.component.scss'
})
export class DocumentGridComponent implements OnInit {
  private documentService = inject(DocumentService);
  private documentTypeService = inject(DocumentTypeService);
  private folderService = inject(FolderService);
  private auditService = inject(AuditService);
  auth = inject(AuthService);
  private exportImport = inject(ExportImportService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);
  private documentAccess = inject(DocumentAccessService);
  private masterListService = inject(MasterListService);
  private route = inject(ActivatedRoute);

  documents = signal<ArchiveDocument[]>([]);
  folders = signal<Folder[]>([]);
  documentTypes = signal<DocumentTypeEntry[]>([]);
  authors = signal<{ name: string }[]>([{ name: 'الكل' }]);
  senders = signal<{ name: string }[]>([{ name: 'الكل' }]);
  receivers = signal<{ name: string }[]>([{ name: 'الكل' }]);
  departments = signal<{ name: string }[]>([{ name: 'الكل' }]);
  filtered = signal<ArchiveDocument[]>([]);
  selectedTypeId = signal<number | 'الكل'>('الكل');
  selectedConfidentiality = signal<ConfidentialityLevel | 'الكل'>('الكل');
  selectedFolder = signal<number | 'الكل'>('الكل');
  selectedAuthor = signal<string>('الكل');
  selectedSender = signal<string>('الكل');
  selectedReceiver = signal<string>('الكل');
  selectedDepartment = signal<string>('الكل');
  search = signal('');
  loading = signal(false);

  confidentialityLevels: { value: ConfidentialityLevel | 'الكل'; label: string }[] = [
    { value: 'الكل', label: 'الكل' },
    { value: 'عادي', label: '🟢 عادي' },
    { value: 'سري', label: '🟡 سري' },
    { value: 'سري للغاية', label: '🔴 سري للغاية' }
  ];

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
    const [docs, fldrs, types] = await Promise.all([
      this.documentService.getAll(),
      this.folderService.getAll(),
      this.documentTypeService.getAll(true),
      this.loadFilterLists()
    ]);
    this.documents.set(docs);
    this.folders.set(fldrs);
    this.documentTypes.set(types);
    this.applyFilters();
  }

  async loadFilterLists(): Promise<void> {
    try {
      const [authors, senders, receivers, departments] = await Promise.all([
        this.masterListService.getAll('author', true),
        this.masterListService.getAll('sender', true),
        this.masterListService.getAll('receiver', true),
        this.masterListService.getAll('department', true)
      ]);
      this.authors.set([{ name: 'الكل' }, ...authors.map(a => ({ name: a.name }))]);
      this.senders.set([{ name: 'الكل' }, ...senders.map(a => ({ name: a.name }))]);
      this.receivers.set([{ name: 'الكل' }, ...receivers.map(a => ({ name: a.name }))]);
      this.departments.set([{ name: 'الكل' }, ...departments.map(a => ({ name: a.name }))]);
    } catch {
      // ignore - filters fall back to "الكل" only
    }
  }

  applyFilters(): void {
    let list = this.documents();
    const typeId = this.selectedTypeId();
    const folder = this.selectedFolder();
    const conf = this.selectedConfidentiality();
    const author = this.selectedAuthor();
    const sender = this.selectedSender();
    const receiver = this.selectedReceiver();
    const department = this.selectedDepartment();
    const term = this.search().trim().toLowerCase();

    if (typeId !== 'الكل') {
      list = list.filter(d => d.type_id === typeId);
    }
    if (folder !== 'الكل') {
      list = list.filter(d => d.folder_id === folder);
    }
    if (conf !== 'الكل') {
      list = list.filter(d => d.confidentiality === conf);
    }
    if (author !== 'الكل') {
      list = list.filter(d => d.author === author);
    }
    if (sender !== 'الكل') {
      list = list.filter(d => d.sender === sender);
    }
    if (receiver !== 'الكل') {
      list = list.filter(d => d.receiver === receiver);
    }
    if (department !== 'الكل') {
      list = list.filter(d => d.sender === department || d.receiver === department);
    }
    if (term) {
      list = list.filter(d => {
        const searchable = [
          d.subject,
          d.ref_number,
          d.sender,
          d.receiver,
          d.author,
          d.writer_name,
          d.content,
          d.address,
          d.notes
        ].filter((value): value is string => Boolean(value));

        return searchable.some(value => value.toLowerCase().includes(term));
      });
    }
    this.filtered.set(list);
  }

  setType(typeId: number | 'الكل'): void {
    this.selectedTypeId.set(typeId);
    this.applyFilters();
  }

  setConfidentiality(level: ConfidentialityLevel | 'الكل'): void {
    this.selectedConfidentiality.set(level);
    this.applyFilters();
  }

  setFolder(folderId: number | 'الكل'): void {
    this.selectedFolder.set(folderId);
    this.applyFilters();
  }

  setAuthor(name: string): void {
    this.selectedAuthor.set(name);
    this.applyFilters();
  }

  setSender(name: string): void {
    this.selectedSender.set(name);
    this.applyFilters();
  }

  setReceiver(name: string): void {
    this.selectedReceiver.set(name);
    this.applyFilters();
  }

  setDepartment(name: string): void {
    this.selectedDepartment.set(name);
    this.applyFilters();
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.applyFilters();
  }

  clearFilters(): void {
    this.selectedTypeId.set('الكل');
    this.selectedConfidentiality.set('الكل');
    this.selectedFolder.set('الكل');
    this.selectedAuthor.set('الكل');
    this.selectedSender.set('الكل');
    this.selectedReceiver.set('الكل');
    this.selectedDepartment.set('الكل');
    this.search.set('');
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

  async onView(doc: ArchiveDocument): Promise<void> {
    const verified = await this.documentAccess.verifyAccess(doc, 'view');
    if (!verified) return;
    this.dialog.open(DocumentViewComponent, {
      width: '850px',
      maxWidth: '95vw',
      data: { doc, folder: this.folders().find(f => f.id === doc.folder_id) }
    });
  }

  async onEdit(doc: ArchiveDocument): Promise<void> {
    const verified = await this.documentAccess.verifyAccess(doc, 'edit');
    if (!verified) return;
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
    // Verify access first for "سري للغاية" (and "سري") documents.
    const verified = await this.documentAccess.verifyAccess(doc, 'delete');
    if (!verified) return;

    if (!confirm('هل أنت متأكد من حذف الوثيقة؟')) return;
    await this.documentService.delete(doc.id!);
    await this.auditService.log('حذف', doc.ref_number, doc.subject);
    await this.loadData();
    this.toast.show('تم حذف الوثيقة', 'success');
  }

  async onPrint(doc: ArchiveDocument): Promise<void> {
    // Verify access first for "سري للغاية" (and "سري") documents.
    const verified = await this.documentAccess.verifyAccess(doc, 'print');
    if (!verified) return;
    this.dialog.open(DocumentViewComponent, {
      width: '850px',
      maxWidth: '95vw',
      data: { doc, folder: this.folders().find(f => f.id === doc.folder_id), print: true, verified: true }
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
