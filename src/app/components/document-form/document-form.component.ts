import { Component, inject, signal, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ArchiveDocument, DocumentType, Attachment } from '../../models/document.model';
import { Folder } from '../../models/folder.model';
import { DocumentService } from '../../services/document.service';
import { FolderService } from '../../services/folder.service';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { SignatureService } from '../../services/signature.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-document-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './document-form.component.html',
  styleUrl: './document-form.component.scss'
})
export class DocumentFormComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<DocumentFormComponent>);
  private data = inject<{ doc?: ArchiveDocument }>(MAT_DIALOG_DATA);
  private documentService = inject(DocumentService);
  private folderService = inject(FolderService);
  private auditService = inject(AuditService);
  private auth = inject(AuthService);
  private signatureService = inject(SignatureService);
  private toast = inject(ToastService);

  @ViewChild('sigCanvas', { static: false }) sigCanvasRef?: ElementRef<HTMLCanvasElement>;

  folders = signal<Folder[]>([]);
  types: DocumentType[] = ['صادر', 'وارد', 'مراسلات'];
  doc = signal<ArchiveDocument>(this.emptyDoc());
  attachments = signal<Attachment[]>([]);
  drawing = signal(false);
  dragOver = signal(false);
  generatingRef = signal(false);
  today = new Date().toISOString().split('T')[0];

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
    this.folders.set(await this.folderService.getAll());
    if (this.data?.doc) {
      const existing = { ...this.data.doc };
      this.doc.set(existing);
      this.attachments.set(this.documentService.parseAttachments(existing));
    } else {
      this.doc.set(this.emptyDoc());
    }
  }

  emptyDoc(): ArchiveDocument {
    return {
      ref_number: '',
      type: 'صادر',
      folder_id: this.folders()[0]?.id ?? 1,
      subject: '',
      sender: '',
      receiver: '',
      date: this.today,
      body: '',
      notes: '',
      status: 'قيد الاعتماد',
      attachments_json: '[]'
    };
  }

  updateDoc<K extends keyof ArchiveDocument>(key: K, value: ArchiveDocument[K]): void {
    this.doc.update(d => ({ ...d, [key]: value }));
  }

  async generateRef(): Promise<void> {
    const d = this.doc();
    this.generatingRef.set(true);
    const ref = await this.documentService.getNextRef(d.type, d.folder_id);
    this.doc.update(doc => ({ ...doc, ref_number: ref }));
    this.generatingRef.set(false);
  }

  onTypeChange(type: DocumentType): void {
    this.doc.update(doc => ({ ...doc, type }));
    if (!this.doc().ref_number) {
      this.generateRef();
    }
  }

  onFolderChange(folderId: number): void {
    this.doc.update(doc => ({ ...doc, folder_id: folderId }));
    if (!this.doc().ref_number) {
      this.generateRef();
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
    const d = this.doc();
    if (!d.ref_number) {
      this.toast.show('يرجى توليد الرقم المرجعي', 'warning');
      return;
    }
    if (!d.subject || !d.folder_id || !d.date || !d.sender) {
      this.toast.show('يرجى ملء الحقول الإلزامية', 'warning');
      return;
    }
    if (d.type === 'صادر' && (!d.receiver || !d.author)) {
      this.toast.show('يرجى ملء الجهة المستقبلة واسم المؤلف', 'warning');
      return;
    }
    if (d.type === 'وارد' && !d.input_method) {
      this.toast.show('يرجى اختيار طريقة الاستلام', 'warning');
      return;
    }
    if (d.type === 'مراسلات' && !d.receiver) {
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

    try {
      if (d.id) {
        await this.documentService.update(payload);
        await this.auditService.log('تعديل', d.ref_number, d.subject);
      } else {
        const id = await this.documentService.create(payload);
        payload.id = id;
        await this.auditService.log('إنشاء', d.ref_number, d.subject);
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      this.toast.show(message, 'error');
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
