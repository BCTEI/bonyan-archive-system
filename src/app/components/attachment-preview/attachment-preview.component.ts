import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Attachment } from '../../models/document.model';
import { ToastService } from '../../services/toast.service';
import { convertDocxToHtml } from '../../utils/docx-preview.util';

type PreviewKind = 'pdf' | 'image' | 'docx' | 'unsupported';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

@Component({
  selector: 'app-attachment-preview',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './attachment-preview.component.html',
  styleUrl: './attachment-preview.component.scss'
})
export class AttachmentPreviewComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<AttachmentPreviewComponent>);
  data = inject<{ attachment: Attachment; refNumber?: string }>(MAT_DIALOG_DATA);
  private sanitizer = inject(DomSanitizer);
  private toast = inject(ToastService);

  attachment: Attachment = this.data.attachment;
  kind: PreviewKind = 'unsupported';
  loading = signal(false);
  conversionFailed = signal(false);

  pdfUrl?: SafeResourceUrl;
  imageUrl?: string;
  docxHtml?: string;

  ngOnInit(): void {
    const ext = (this.attachment.ext || '').toLowerCase();
    if (ext === 'pdf') {
      this.kind = 'pdf';
      this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(`data:application/pdf;base64,${this.attachment.base64}`);
    } else if (IMAGE_EXTS.includes(ext)) {
      this.kind = 'image';
      this.imageUrl = `data:${IMAGE_MIME[ext]};base64,${this.attachment.base64}`;
    } else if (ext === 'docx') {
      this.kind = 'docx';
      void this.loadDocx();
    } else {
      this.kind = 'unsupported';
    }
  }

  private async loadDocx(): Promise<void> {
    this.loading.set(true);
    try {
      // convertDocxToHtml already runs the output through DOMPurify, so this
      // string can go straight into [innerHTML] without a trust bypass.
      this.docxHtml = await convertDocxToHtml(this.attachment.base64);
    } catch (err) {
      console.error('[AttachmentPreview] DOCX conversion failed:', err);
      this.conversionFailed.set(true);
      this.kind = 'unsupported';
    } finally {
      this.loading.set(false);
    }
  }

  formatSize(bytes: number): string {
    if (!bytes) return '—';
    const units = ['بايت', 'ك.بايت', 'م.بايت', 'ج.بايت'];
    let size = bytes;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async openExternally(): Promise<void> {
    const result = await window.electronAPI.openAttachment(this.attachment.base64, this.attachment.name, this.attachment.ext);
    if (!result.success) {
      this.toast.show(result.message || 'تعذر فتح المرفق', 'error');
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
