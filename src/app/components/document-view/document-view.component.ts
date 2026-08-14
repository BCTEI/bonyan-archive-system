import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ArchiveDocument, Attachment } from '../../models/document.model';
import { Folder } from '../../models/folder.model';
import { User } from '../../models/user.model';
import { DocumentService } from '../../services/document.service';
import { AuditService } from '../../services/audit.service';
import { AuthService } from '../../services/auth.service';
import { PrintService } from '../../services/print.service';
import { DocumentAccessService } from '../../services/document-access.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-document-view',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './document-view.component.html',
  styleUrl: './document-view.component.scss'
})
export class DocumentViewComponent implements OnInit {
  dialogRef = inject(MatDialogRef<DocumentViewComponent>);
  data = inject<{ doc: ArchiveDocument; folder?: Folder; print?: boolean; verified?: boolean }>(MAT_DIALOG_DATA);
  documentService = inject(DocumentService);
  auditService = inject(AuditService);
  auth = inject(AuthService);
  printService = inject(PrintService);
  documentAccess = inject(DocumentAccessService);
  toast = inject(ToastService);

  doc: ArchiveDocument = this.data.doc;
  folder?: Folder = this.data.folder;
  currentUser: User | null = null;
  attachments: Attachment[] = [];

  async ngOnInit(): Promise<void> {
    this.attachments = this.documentService.parseAttachments(this.doc);
    this.currentUser = this.auth.currentUser();
    await this.auditService.log('عرض', this.doc.ref_number, this.doc.subject);
    if (this.data.print) {
      setTimeout(() => this.handlePrint(), 500);
    }
  }

  async openAttachment(att: Attachment): Promise<void> {
    const result = await window.electronAPI.openAttachment(att.base64, att.name, att.ext);
    if (!result.success) {
      console.error(result.message);
    }
  }

  async handlePrint(): Promise<void> {
    // If the caller already verified access (e.g. from the document grid),
    // skip the redundant verification prompt.
    if (!this.data.verified) {
      const allowed = await this.documentAccess.verifyAccess(this.doc, 'print');
      if (!allowed) {
        this.toast.show('تم رفض الوصول: يتطلب التحقق من الهوية لهذه الوثيقة', 'error');
        return;
      }
    }
    this.printService.printDocument(this.doc, this.folder?.name ?? '', this.currentUser);
  }

  print(): void {
    void this.handlePrint();
  }

  inputMethodLabel(method: string): string {
    switch (method) {
      case 'upload': return 'تحميل من الجهاز';
      case 'camera': return 'التقاط صورة';
      case 'scanner': return 'الماسح الضوئي';
      default: return method;
    }
  }

  confClass(level: string): string {
    switch (level) {
      case 'عادي': return 'bg-success/10 text-success';
      case 'سري': return 'bg-warning/10 text-warning';
      case 'سري للغاية': return 'bg-danger/10 text-danger';
      default: return 'bg-secondary text-text';
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
