import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ArchiveDocument, Attachment } from '../../models/document.model';
import { Folder } from '../../models/folder.model';
import { DocumentService } from '../../services/document.service';
import { AuditService } from '../../services/audit.service';

@Component({
  selector: 'app-document-view',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './document-view.component.html',
  styleUrl: './document-view.component.scss'
})
export class DocumentViewComponent implements OnInit {
  dialogRef = inject(MatDialogRef<DocumentViewComponent>);
  data = inject<{ doc: ArchiveDocument; folder?: Folder; print?: boolean }>(MAT_DIALOG_DATA);
  documentService = inject(DocumentService);
  auditService = inject(AuditService);

  doc: ArchiveDocument = this.data.doc;
  folder?: Folder = this.data.folder;
  attachments: Attachment[] = [];

  async ngOnInit(): Promise<void> {
    this.attachments = this.documentService.parseAttachments(this.doc);
    await this.auditService.log('عرض', this.doc.ref_number, this.doc.subject);
    if (this.data.print) {
      setTimeout(() => this.print(), 500);
    }
  }

  async openAttachment(att: Attachment): Promise<void> {
    const result = await window.electronAPI.openAttachment(att.base64, att.name, att.ext);
    if (!result.success) {
      console.error(result.message);
    }
  }

  print(): void {
    window.electronAPI.print();
  }

  inputMethodLabel(method: string): string {
    switch (method) {
      case 'upload': return 'تحميل من الجهاز';
      case 'camera': return 'التقاط صورة';
      case 'scanner': return 'الماسح الضوئي';
      default: return method;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
