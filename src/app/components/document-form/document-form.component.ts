import { Component, inject, signal, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { ArchiveDocument, DocumentTypeEntry, Attachment, ConfidentialityLevel } from '../../models/document.model';
import { Folder } from '../../models/folder.model';
import { FlatOrgUnit } from '../../models/org-unit.model';
import { DocumentService } from '../../services/document.service';
import { DocumentTypeService } from '../../services/document-type.service';
import { FolderService } from '../../services/folder.service';
import { MasterListService } from '../../services/master-list.service';
import { AuthService } from '../../services/auth.service';
import { OrgUnitService } from '../../services/org-unit.service';
import { SignatureService } from '../../services/signature.service';
import { ToastService } from '../../services/toast.service';
import { MasterListEntry, MasterListType } from '../../models/master-list.model';
import { FinalConfirmDialogComponent } from '../dialogs/final-confirm-dialog/final-confirm-dialog.component';
import { HasPermissionDirective } from '../../directives/has-permission.directive';

@Component({
  selector: 'app-document-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule, HasPermissionDirective],
  templateUrl: './document-form.component.html',
  styleUrl: './document-form.component.scss'
})
export class DocumentFormComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<DocumentFormComponent>);
  private data = inject<{ doc?: ArchiveDocument }>(MAT_DIALOG_DATA);
  private documentService = inject(DocumentService);
  private documentTypeService = inject(DocumentTypeService);
  private folderService = inject(FolderService);
  private masterListService = inject(MasterListService);
  private auth = inject(AuthService);
  private orgUnitService = inject(OrgUnitService);
  private signatureService = inject(SignatureService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  @ViewChild('sigCanvas', { static: false }) sigCanvasRef?: ElementRef<HTMLCanvasElement>;

  folders = signal<Folder[]>([]);
  documentTypes = signal<DocumentTypeEntry[]>([]);
  selectedType = signal<DocumentTypeEntry | undefined>(undefined);
  doc = signal<ArchiveDocument>(this.emptyDoc());
  attachments = signal<Attachment[]>([]);
  drawing = signal(false);
  dragOver = signal(false);
  isSaving = signal(false);
  today = new Date().toISOString().split('T')[0];

  authors = signal<MasterListEntry[]>([]);
  preparers = signal<MasterListEntry[]>([]);
  senders = signal<MasterListEntry[]>([]);
  receivers = signal<MasterListEntry[]>([]);
  departments = signal<MasterListEntry[]>([]);

  filteredAuthors = signal<MasterListEntry[]>([]);
  filteredPreparers = signal<MasterListEntry[]>([]);
  filteredSenders = signal<MasterListEntry[]>([]);
  filteredReceivers = signal<MasterListEntry[]>([]);
  filteredDepartments = signal<MasterListEntry[]>([]);

  quickAddType = signal<MasterListType | null>(null);
  quickAddName = signal('');

  orgUnitOptions = signal<FlatOrgUnit[]>([]);

  fieldErrors = signal<Record<string, string>>({});
  folderSearchText = signal('');
  filteredFolders = signal<Folder[]>([]);
  private initialSnapshot = '';

  confidentialityLevels: ConfidentialityLevel[] = ['عادي', 'سري', 'سري للغاية'];

  // CSV is included both by MIME (browsers variously report text/csv,
  // application/csv or even application/vnd.ms-excel for it) and by extension.
  allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'image/jpeg',
    'image/png',
    'image/webp'
  ];
  allowedExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'webp'];

  async ngOnInit(): Promise<void> {
    const [types, fldrs] = await Promise.all([
      this.documentTypeService.getAll(true),
      this.folderService.getAll(),
      this.loadMasterLists(),
      this.loadOrgUnitOptions()
    ]);
    this.documentTypes.set(types);
    this.folders.set(fldrs);

    if (this.data?.doc) {
      const existing = { ...this.data.doc };
      this.doc.set(existing);
      this.selectedType.set(types.find(t => t.id === existing.type_id));
      this.attachments.set(this.documentService.parseAttachments(existing));
    } else {
      const defaultType = types[0];
      this.selectedType.set(defaultType);
      this.doc.set(this.emptyDoc(defaultType?.id ?? 1));
      // ref_number stays empty for a new document — the main process allocates
      // it from the yearly archive sequence at the moment document:create runs,
      // so it is never pre-fetched (and never wasted on an abandoned form).
    }

    this.filteredFolders.set(fldrs);
    this.folderSearchText.set(this.folderLabel(this.doc().folder_id));
    this.initialSnapshot = this.snapshot();
  }

  /** Org-unit selection is offered to section_head and above; employees never see it (server stamps their own unit). */
  showOrgUnitControl(): boolean {
    return this.auth.currentUser()?.role !== 'employee';
  }

  isHeadRole(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'dept_head' || role === 'section_head';
  }

  async loadOrgUnitOptions(): Promise<void> {
    if (!this.showOrgUnitControl()) return;
    try {
      this.orgUnitOptions.set(await this.orgUnitService.getFlatTree(true));
    } catch {
      // Non-fatal: the field will just be empty; the server still defaults org_unit_id.
    }
  }

  async loadMasterLists(): Promise<void> {
    try {
      const [authors, preparers, senders, receivers, departments] = await Promise.all([
        this.masterListService.getAll('message_author', true),
        this.masterListService.getAll('preparer', true),
        this.masterListService.getAll('sender', true),
        this.masterListService.getAll('receiver', true),
        this.masterListService.getAll('department', true)
      ]);
      this.authors.set(authors);
      this.preparers.set(preparers);
      this.senders.set(senders);
      this.receivers.set(receivers);
      this.departments.set(departments);
      this.filteredAuthors.set(authors);
      this.filteredPreparers.set(preparers);
      this.filteredSenders.set(senders);
      this.filteredReceivers.set(receivers);
      this.filteredDepartments.set(departments);
    } catch (err) {
      console.warn('[DocumentForm] Failed to load master lists:', err);
    }
  }

  emptyDoc(typeId = 1): ArchiveDocument {
    return {
      ref_number: '',
      type_id: typeId,
      folder_id: this.folders()[0]?.id ?? 1,
      confidentiality: 'عادي',
      subject: '',
      sender: '',
      receiver: '',
      message_author: '',
      message_preparer: '',
      date: this.today,
      status: 'قيد الاعتماد',
      attachments_json: '[]',
      org_unit_id: this.auth.currentUser()?.org_unit_id ?? null
    };
  }

  updateDoc<K extends keyof ArchiveDocument>(key: K, value: ArchiveDocument[K]): void {
    this.doc.update(d => ({ ...d, [key]: value }));
    this.clearFieldError(key as string);
  }

  clearFieldError(key: string): void {
    if (!this.fieldErrors()[key]) return;
    this.fieldErrors.update(map => {
      const next = { ...map };
      delete next[key];
      return next;
    });
  }

  onTypeChange(typeId: number): void {
    const type = this.documentTypes().find(t => t.id === typeId);
    this.selectedType.set(type);
    this.doc.update(doc => ({ ...doc, type_id: typeId }));
    this.clearFieldError('type');
  }

  onFolderChange(folderId: number): void {
    this.doc.update(doc => ({ ...doc, folder_id: folderId }));
    this.clearFieldError('folder');
  }

  onConfidentialityChange(level: ConfidentialityLevel): void {
    this.doc.update(doc => ({ ...doc, confidentiality: level }));
  }

  private folderLabel(id: number | null | undefined): string {
    const f = this.folders().find(x => x.id === id);
    return f ? `#${f.id} — ${f.name}` : '';
  }

  /** mat-autocomplete displayWith: shows the "#id — name" label for the selected folder id. */
  displayFolder = (id: number | null): string => this.folderLabel(id);

  onFolderInput(value: string | number): void {
    // Option selections emit the numeric folder id here — onFolderSelected
    // handles those; only free-typed text drives the filter.
    if (typeof value !== 'string') return;
    this.folderSearchText.set(value);
    const term = value.trim().toLowerCase();
    this.filteredFolders.set(
      !term
        ? this.folders()
        : this.folders().filter(f => f.name.toLowerCase().includes(term) || String(f.id).includes(term))
    );
  }

  onFolderSelected(id: number): void {
    this.onFolderChange(id);
    this.folderSearchText.set(this.folderLabel(id));
  }

  private snapshot(): string {
    return JSON.stringify({ doc: this.doc(), attachments: this.attachments() });
  }

  /** Dirty = any field/attachment changed since load, or a signature drawn but not yet saved. */
  isDirty(): boolean {
    const canvas = this.getCanvas();
    const canvasDirty = !!canvas && !this.signatureService.isEmpty(canvas);
    return this.snapshot() !== this.initialSnapshot || canvasDirty;
  }

  typeName(typeId: number): string {
    return this.documentTypes().find(t => t.id === typeId)?.name ?? '';
  }

  // ── Type-aware correspondence helpers ─────────────────────────────────────
  // Sender/receiver are shown for EVERY document type (incoming included);
  // only the labels and the suggestion lists adapt to the type.
  isOutgoing(): boolean { return this.typeName(this.doc().type_id) === 'صادر'; }
  isIncoming(): boolean { return this.typeName(this.doc().type_id) === 'وارد'; }
  isInternalMail(): boolean { return this.typeName(this.doc().type_id) === 'مراسلات'; }

  senderLabel(): string {
    if (this.isOutgoing()) return 'الجهة المرسلة (المؤسسة)';
    if (this.isIncoming()) return 'الجهة المرسلة (خارجية)';
    if (this.isInternalMail()) return 'القسم / الجهة المرسلة';
    return 'المرسل';
  }

  receiverLabel(): string {
    if (this.isOutgoing()) return 'الجهة المستقبلة (خارجية)';
    if (this.isIncoming()) return 'الجهة المستلمة (داخل المؤسسة)';
    if (this.isInternalMail()) return 'القسم المستهدف / المستقبل';
    return 'المستلم';
  }

  dateLabel(): string {
    if (this.isOutgoing()) return 'تاريخ الإصدار';
    if (this.isIncoming()) return 'تاريخ الاستلام';
    if (this.isInternalMail()) return 'تاريخ المراسلة';
    return 'التاريخ';
  }

  /** Internal correspondence is addressed between departments; other types use the sender/receiver master lists. */
  senderItems(): MasterListEntry[] {
    return this.isInternalMail() ? this.filteredDepartments() : this.filteredSenders();
  }

  receiverItems(): MasterListEntry[] {
    return this.isInternalMail() ? this.filteredDepartments() : this.filteredReceivers();
  }

  onSenderInput(value: string): void {
    this.updateDoc('sender', value);
    if (this.isInternalMail()) this.filterDepartments(value); else this.filterSenders(value);
  }

  onReceiverInput(value: string): void {
    this.updateDoc('receiver', value);
    if (this.isInternalMail()) this.filterDepartments(value); else this.filterReceivers(value);
  }

  partyListType(): MasterListType {
    return this.isInternalMail() ? 'department' : 'sender';
  }

  receiverListType(): MasterListType {
    return this.isInternalMail() ? 'department' : 'receiver';
  }

  filterAuthors(term: string): void {
    const t = term.toLowerCase();
    this.filteredAuthors.set(this.authors().filter(a => a.name.toLowerCase().includes(t)));
  }

  filterPreparers(term: string): void {
    const t = term.toLowerCase();
    this.filteredPreparers.set(this.preparers().filter(a => a.name.toLowerCase().includes(t)));
  }

  filterSenders(term: string): void {
    const t = term.toLowerCase();
    this.filteredSenders.set(this.senders().filter(a => a.name.toLowerCase().includes(t)));
  }

  filterReceivers(term: string): void {
    const t = term.toLowerCase();
    this.filteredReceivers.set(this.receivers().filter(a => a.name.toLowerCase().includes(t)));
  }

  filterDepartments(term: string): void {
    const t = term.toLowerCase();
    this.filteredDepartments.set(this.departments().filter(a => a.name.toLowerCase().includes(t)));
  }

  openQuickAdd(type: MasterListType, initialName: string): void {
    this.quickAddType.set(type);
    this.quickAddName.set(initialName.trim());
  }

  cancelQuickAdd(): void {
    this.quickAddType.set(null);
    this.quickAddName.set('');
  }

  async confirmQuickAdd(): Promise<void> {
    const type = this.quickAddType();
    const name = this.quickAddName().trim();
    if (!type || !name) return;

    try {
      await this.masterListService.create({ list_type: type, name });
      await this.loadMasterLists();
      this.toast.show('تمت إضافة العنصر إلى القائمة الرئيسية', 'success');
      this.quickAddType.set(null);
      this.quickAddName.set('');
    } catch (err: unknown) {
      this.toast.showError(err, 'فشل الإضافة');
    }
  }

  getCanvas(): HTMLCanvasElement | undefined {
    return this.sigCanvasRef?.nativeElement;
  }

  startDraw(e: MouseEvent | TouchEvent): void {
    e.preventDefault();
    this.drawing.set(true);
    const canvas = this.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    const pos = this.getPos(e, canvas);
    ctx.moveTo(pos.x, pos.y);
  }

  draw(e: MouseEvent | TouchEvent): void {
    if (!this.drawing()) return;
    e.preventDefault();
    const canvas = this.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = this.getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  endDraw(): void {
    this.drawing.set(false);
  }

  getPos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX) : e.clientX;
    const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY) : e.clientY;
    // Scale from CSS pixels to canvas backing-store pixels — w-full stretches
    // the fixed 600x150 canvas, so raw client coords land offset/distorted.
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  clearSignature(): void {
    const canvas = this.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) {
      this.handleFiles(e.dataTransfer.files);
    }
  }

  onFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      this.handleFiles(input.files);
    }
  }

  async handleFiles(files: FileList): Promise<void> {
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!this.allowedTypes.includes(file.type) && !this.allowedExts.includes(ext)) {
        this.toast.show(`نوع الملف غير مدعوم: ${file.name}`, 'warning');
        continue;
      }
      const base64 = await this.readFile(file);
      this.attachments.update(list => [...list, {
        name: file.name.replace(/\.[^/.]+$/, ''),
        ext,
        size: file.size,
        base64
      }]);
    }
  }

  readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  removeAttachment(index: number): void {
    this.attachments.update(list => list.filter((_, i) => i !== index));
  }

  /**
   * Collects every validation failure into fieldErrors (keys match the
   * template's data-field markers, in top-to-bottom visual order) and reports
   * whether the form is valid.
   */
  private validate(): boolean {
    const d = this.doc();
    const type = this.selectedType();
    const errors: Record<string, string> = {};

    if (!d.type_id || !type) {
      errors['type'] = 'يرجى اختيار نوع الوثيقة';
    }
    if (!d.folder_id) {
      errors['folder'] = 'المجلد مطلوب';
    }
    if (!(d.subject ?? '').trim()) {
      errors['subject'] = 'الموضوع مطلوب';
    }
    if (!d.date) {
      errors['date'] = 'التاريخ مطلوب';
    }
    if (!(d.sender ?? '').trim()) {
      errors['sender'] = 'المرسل مطلوب';
    }
    // Receiver is required for every type — incoming documents must name the
    // internal recipient just as outgoing ones name the external recipient.
    if (!(d.receiver ?? '').trim()) {
      errors['receiver'] = 'المستلم مطلوب';
    }
    if (type && type.name === 'صادر' && !(d.message_author ?? '').trim()) {
      errors['message_author'] = 'يرجى ملء اسم منشئ الرسالة';
    }
    if (type && type.name === 'وارد' && !d.input_method) {
      errors['input_method'] = 'يرجى اختيار طريقة الاستلام';
    }

    this.fieldErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  /** Scrolls the first invalid field into view and focuses its control. */
  private focusFirstError(): void {
    setTimeout(() => {
      const firstKey = Object.keys(this.fieldErrors())[0];
      if (!firstKey) return;
      const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    });
  }

  async save(): Promise<void> {
    if (this.isSaving()) return;

    const d = this.doc();
    if (!this.validate()) {
      this.toast.show('يرجى تصحيح الحقول المحددة باللون الأحمر', 'warning');
      this.focusFirstError();
      return;
    }

    // A signature drawn but never explicitly saved is captured here so it cannot
    // be lost; an untouched canvas leaves any previously saved signature intact.
    const canvas = this.getCanvas();
    const signature = canvas && !this.signatureService.isEmpty(canvas)
      ? this.signatureService.toBase64(canvas)
      : d.signature_base64;

    // Trim before storing so no stray spaces reach the archive.
    const sender = (d.sender ?? '').trim();
    const receiver = (d.receiver ?? '').trim();
    const subject = (d.subject ?? '').trim();

    const payload: ArchiveDocument = {
      ...d,
      sender,
      receiver,
      subject,
      signature_base64: signature,
      attachments_json: JSON.stringify(this.attachments()),
      created_by: this.auth.currentUser()?.username
    };

    this.isSaving.set(true);
    try {
      // The main process writes the audit entry for create/update — logging
      // here too would produce two rows per action.
      if (d.id) {
        await this.documentService.update(payload);
      } else {
        const { id, ref_number } = await this.documentService.create(payload);
        payload.id = id;
        payload.ref_number = ref_number;
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      this.toast.showError(err, 'فشل الحفظ');
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel(): void {
    if (!this.isDirty()) {
      this.dialogRef.close(false);
      return;
    }
    this.dialog.open(FinalConfirmDialogComponent, {
      width: '420px',
      maxWidth: '95vw',
      data: {
        title: 'تجاهل التغييرات؟',
        message: 'لديك بيانات غير محفوظة في هذه الوثيقة.',
        warning: 'سيتم فقدان جميع البيانات المدخلة ولن يمكن استرجاعها.',
        confirmText: 'تجاهل التغييرات'
      }
    }).afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) this.dialogRef.close(false);
    });
  }
}
