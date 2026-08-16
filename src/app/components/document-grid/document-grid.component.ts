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
import { FinalConfirmDialogComponent } from '../dialogs/final-confirm-dialog/final-confirm-dialog.component';
import { DocumentAccessService } from '../../services/document-access.service';
import { DocumentService } from '../../services/document.service';
import { DocumentTypeService } from '../../services/document-type.service';
import { FolderService } from '../../services/folder.service';
import { MasterListService } from '../../services/master-list.service';
import { AuthService } from '../../services/auth.service';
import { ExportImportService } from '../../services/export-import.service';
import { ToastService } from '../../services/toast.service';
import { PrintService } from '../../services/print.service';
import { ArchiveDocument, DocumentTypeEntry, ConfidentialityLevel, SUSPENDED_STATUS } from '../../models/document.model';
import { Folder } from '../../models/folder.model';

// Fixed prefix of every reference number (see generateArchiveRefNumber in
// electron/database.ts) — the ref-number search field shows this as a
// permanent chip so the user only ever types the variable part.
export const REF_NUMBER_PREFIX = 'م.ب/';

export type StatusFilter = 'all' | 'active' | 'suspended';

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
  auth = inject(AuthService);
  private exportImport = inject(ExportImportService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);
  private documentAccess = inject(DocumentAccessService);
  private masterListService = inject(MasterListService);
  private route = inject(ActivatedRoute);
  private printService = inject(PrintService);

  documents = signal<ArchiveDocument[]>([]);
  folders = signal<Folder[]>([]);
  documentTypes = signal<DocumentTypeEntry[]>([]);
  authors = signal<{ name: string }[]>([{ name: 'الكل' }]);
  preparers = signal<{ name: string }[]>([{ name: 'الكل' }]);
  senders = signal<{ name: string }[]>([{ name: 'الكل' }]);
  receivers = signal<{ name: string }[]>([{ name: 'الكل' }]);
  departments = signal<{ name: string }[]>([{ name: 'الكل' }]);
  filtered = signal<ArchiveDocument[]>([]);
  selectedTypeId = signal<number | 'الكل'>('الكل');
  selectedConfidentiality = signal<ConfidentialityLevel | 'الكل'>('الكل');
  selectedFolder = signal<number | 'الكل'>('الكل');
  selectedAuthor = signal<string>('الكل');
  selectedPreparer = signal<string>('الكل');
  selectedSender = signal<string>('الكل');
  selectedReceiver = signal<string>('الكل');
  selectedDepartment = signal<string>('الكل');
  // Suspended documents stay in the archive but are hidden from the active
  // list unless the user explicitly asks for them.
  selectedStatus = signal<StatusFilter>('active');
  search = signal('');
  subjectSearch = signal('');
  refNumberSearch = signal('');
  loading = signal(false);

  readonly refNumberPrefix = REF_NUMBER_PREFIX;

  confidentialityLevels: { value: ConfidentialityLevel | 'الكل'; label: string }[] = [
    { value: 'الكل', label: 'الكل' },
    { value: 'عادي', label: '🟢 عادي' },
    { value: 'سري', label: '🟡 سري' },
    { value: 'سري للغاية', label: '🔴 سري للغاية' }
  ];

  statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'active', label: 'النشطة' },
    { value: 'suspended', label: 'الموقوفة' },
    { value: 'all', label: 'الكل' }
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
      const lists = await this.masterListService.loadAllLists(true);
      const withAll = (items: { name: string }[]) => [{ name: 'الكل' }, ...items.map(a => ({ name: a.name }))];
      this.authors.set(withAll(lists.author));
      this.preparers.set(withAll(lists.preparer));
      this.senders.set(withAll(lists.sender));
      this.receivers.set(withAll(lists.receiver));
      this.departments.set(withAll(lists.department));
    } catch {
      // ignore - filters fall back to "الكل" only
    }
  }

  applyFilters(): void {
    let list = this.documents();
    const status = this.selectedStatus();
    const typeId = this.selectedTypeId();
    const folder = this.selectedFolder();
    const conf = this.selectedConfidentiality();
    const author = this.selectedAuthor();
    const preparer = this.selectedPreparer();
    const sender = this.selectedSender();
    const receiver = this.selectedReceiver();
    const department = this.selectedDepartment();
    const term = this.search().trim().toLowerCase();
    const subjectTerm = this.subjectSearch().trim().toLowerCase();
    const refSuffix = this.refNumberSearch().trim();
    const refTerm = refSuffix ? (REF_NUMBER_PREFIX + refSuffix).toLowerCase() : '';

    if (status === 'active') {
      list = list.filter(d => d.status !== SUSPENDED_STATUS);
    } else if (status === 'suspended') {
      list = list.filter(d => d.status === SUSPENDED_STATUS);
    }
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
    if (preparer !== 'الكل') {
      list = list.filter(d => d.writer_name === preparer);
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
    if (subjectTerm) {
      list = list.filter(d => d.subject.toLowerCase().includes(subjectTerm));
    }
    if (refTerm) {
      list = list.filter(d => d.ref_number.toLowerCase().includes(refTerm));
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

  setPreparer(name: string): void {
    this.selectedPreparer.set(name);
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

  setStatus(value: StatusFilter): void {
    this.selectedStatus.set(value);
    this.applyFilters();
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.applyFilters();
  }

  setSubjectSearch(value: string): void {
    this.subjectSearch.set(value);
    this.applyFilters();
  }

  setRefNumberSearch(value: string): void {
    // Defensive: if the user pastes a full reference number (prefix included),
    // strip the prefix so it isn't duplicated against the fixed chip.
    const stripped = value.startsWith(REF_NUMBER_PREFIX) ? value.slice(REF_NUMBER_PREFIX.length) : value;
    this.refNumberSearch.set(stripped);
    this.applyFilters();
  }

  clearFilters(): void {
    this.selectedTypeId.set('الكل');
    this.selectedConfidentiality.set('الكل');
    this.selectedFolder.set('الكل');
    this.selectedAuthor.set('الكل');
    this.selectedPreparer.set('الكل');
    this.selectedSender.set('الكل');
    this.selectedReceiver.set('الكل');
    this.selectedDepartment.set('الكل');
    this.selectedStatus.set('active');
    this.search.set('');
    this.subjectSearch.set('');
    this.refNumberSearch.set('');
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

  /**
   * "Delete" is no longer destructive: the user is asked to confirm a
   * suspension, and the main process sets status = 'موقوف' (audited with
   * previous/new status). The document row, reference number and
   * attachments always remain in the archive.
   */
  onSuspend(doc: ArchiveDocument): void {
    const ref = this.dialog.open(FinalConfirmDialogComponent, {
      width: '440px',
      maxWidth: '95vw',
      data: {
        title: 'إيقاف الوثيقة',
        message: `هل أنت متأكد من إيقاف الوثيقة «${doc.subject}» (${doc.ref_number})؟`,
        warning: 'ستبقى الوثيقة محفوظة بشكل دائم في الأرشيف مع مرفقاتها ورقمها المرجعي، ولن تظهر بعد الآن ضمن الوثائق النشطة.',
        confirmText: 'إيقاف الوثيقة'
      }
    });
    ref.afterClosed().subscribe(async confirmed => {
      if (!confirmed) return;
      try {
        await this.documentService.suspend(doc.id!);
        await this.loadData();
        this.toast.show('تم إيقاف الوثيقة ونقلها خارج القائمة النشطة', 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'فشل إيقاف الوثيقة';
        this.toast.show(message, 'error');
      }
    });
  }

  onPrint(doc: ArchiveDocument): void {
    this.dialog.open(DocumentViewComponent, {
      width: '850px',
      maxWidth: '95vw',
      data: { doc, folder: this.folders().find(f => f.id === doc.folder_id), print: true }
    });
  }

  async onPrintLabel(doc: ArchiveDocument): Promise<void> {
    const allowed = await this.documentAccess.verifyAccess(doc, 'print');
    if (!allowed) return;
    if (!doc.barcode) return;
    this.printService.printBarcodeLabel(doc);
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
