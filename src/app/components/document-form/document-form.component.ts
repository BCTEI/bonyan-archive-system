import { Component, inject, signal, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { ArchiveDocument, DocumentTypeEntry, Attachment, ConfidentialityLevel } from '../../models/document.model';
import { Folder } from '../../models/folder.model';
import { DocumentService } from '../../services/document.service';
import { DocumentTypeService } from '../../services/document-type.service';
import { FolderService } from '../../services/folder.service';
import { MasterListService } from '../../services/master-list.service';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { SignatureService } from '../../services/signature.service';
import { ToastService } from '../../services/toast.service';
import { MasterListEntry, MasterListType } from '../../models/master-list.model';

@Component({
  selector: 'app-document-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule],
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
  private auditService = inject(AuditService);
  private auth = inject(AuthService);
  private signatureService = inject(SignatureService);
  private toast = inject(ToastService);

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
  senders = signal<MasterListEntry[]>([]);
  receivers = signal<MasterListEntry[]>([]);
  departments = signal<MasterListEntry[]>([]);

  filteredAuthors = signal<MasterListEntry[]>([]);
  filteredSenders = signal<MasterListEntry[]>([]);
  filteredReceivers = signal<MasterListEntry[]>([]);
  filteredDepartments = signal<MasterListEntry[]>([]);

  quickAddType = signal<MasterListType | null>(null);
  quickAddName = signal('');

  confidentialityLevels: ConfidentialityLevel[] = ['عادي', 'سري', 'سري للغاية'];

  allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ];
  allowedExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'];

  async ngOnInit(): Promise<void> {
    const [types, fldrs] = await Promise.all([
      this.documentTypeService.getAll(true),
      this.folderService.getAll(),
      this.loadMasterLists()
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
  }

  async loadMasterLists(): Promise<void> {
    try {
      const [authors, senders, receivers, departments] = await Promise.all([
        this.masterListService.getAll('author', true),
        this.masterListService.getAll('sender', true),
        this.masterListService.getAll('receiver', true),
        this.masterListService.getAll('department', true)
      ]);
      this.authors.set(authors);
      this.senders.set(senders);
      this.receivers.set(receivers);
      this.departments.set(departments);
      this.filteredAuthors.set(authors);
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
      date: this.today,
      status: 'قيد الاعتماد',
      attachments_json: '[]'
    };
  }

  updateDoc<K extends keyof ArchiveDocument>(key: K, value: ArchiveDocument[K]): void {
    this.doc.update(d => ({ ...d, [key]: value }));
  }

  onTypeChange(typeId: number): void {
    const type = this.documentTypes().find(t => t.id === typeId);
    this.selectedType.set(type);
    this.doc.update(doc => ({ ...doc, type_id: typeId }));
  }

  onFolderChange(folderId: number): void {
    this.doc.update(doc => ({ ...doc, folder_id: folderId }));
  }

  onConfidentialityChange(level: ConfidentialityLevel): void {
    this.doc.update(doc => ({ ...doc, confidentiality: level }));
  }

  typeName(typeId: number): string {
    return this.documentTypes().find(t => t.id === typeId)?.name ?? '';
  }

  filterAuthors(term: string): void {
    const t = term.toLowerCase();
    this.filteredAuthors.set(this.authors().filter(a => a.name.toLowerCase().includes(t)));
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
      const message = err instanceof Error ? err.message : 'فشل الإضافة';
      this.toast.show(message, 'error');
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
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  clearSignature(): void {
    const canvas = this.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  saveSignature(): void {
    const canvas = this.getCanvas();
    if (!canvas) return;
    if (this.signatureService.isEmpty(canvas)) {
      this.toast.show('يرجى التوقيع أولاً', 'warning');
      return;
    }
    const base64 = this.signatureService.toBase64(canvas);
    this.doc.update(d => ({ ...d, signature_base64: base64 }));
    this.toast.show('تم حفظ التوقيع', 'success');
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

  async save(): Promise<void> {
    if (this.isSaving()) return;

    const d = this.doc();
    const type = this.selectedType();

    if (!d.type_id) {
      this.toast.show('نوع الملف مطلوب', 'warning');
      return;
    }
    if (!type) {
      this.toast.show('يرجى اختيار نوع الوثيقة', 'warning');
      return;
    }
    if (!d.folder_id) {
      this.toast.show('المجلد مطلوب', 'warning');
      return;
    }
    if (!d.date) {
      this.toast.show('التاريخ مطلوب', 'warning');
      return;
    }
    if (!d.sender) {
      this.toast.show('المرسل مطلوب', 'warning');
      return;
    }
    if (!d.receiver) {
      this.toast.show('المستلم مطلوب', 'warning');
      return;
    }
    if (!d.subject) {
      this.toast.show('الموضوع مطلوب', 'warning');
      return;
    }
    if (type.name === 'صادر' && (!d.receiver || !d.author)) {
      this.toast.show('يرجى ملء الجهة المستقبلة واسم المؤلف', 'warning');
      return;
    }
    if (type.name === 'وارد' && !d.input_method) {
      this.toast.show('يرجى اختيار طريقة الاستلام', 'warning');
      return;
    }
    if (type.name === 'مراسلات' && !d.receiver) {
      this.toast.show('يرجى ملء القسم المستهدف', 'warning');
      return;
    }
    if (!d.signature_base64) {
      this.toast.show('التوقيع مطلوب', 'warning');
      return;
    }

    const payload: ArchiveDocument = {
      ...d,
      attachments_json: JSON.stringify(this.attachments()),
      created_by: this.auth.currentUser()?.username
    };

    this.isSaving.set(true);
    try {
      if (d.id) {
        await this.documentService.update(payload);
        await this.auditService.log('تعديل', d.ref_number, d.subject);
      } else {
        const { id, ref_number } = await this.documentService.create(payload);
        payload.id = id;
        payload.ref_number = ref_number;
        await this.auditService.log('إنشاء', ref_number, d.subject);
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      this.toast.show(message, 'error');
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
