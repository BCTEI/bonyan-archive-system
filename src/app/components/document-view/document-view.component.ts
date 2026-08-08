import { AfterViewInit, Component, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
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
import { BarcodeService } from '../../services/barcode.service';
import { HasPermissionDirective } from '../../directives/has-permission.directive';
import { DocumentFormComponent } from '../document-form/document-form.component';

@Component({
  selector: 'app-document-view',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, HasPermissionDirective],
  templateUrl: './document-view.component.html',
  styleUrl: './document-view.component.scss'
})
export class DocumentViewComponent implements OnInit, AfterViewInit {
  dialogRef = inject(MatDialogRef<DocumentViewComponent>);
  data = inject<{ doc: ArchiveDocument; folder?: Folder; print?: boolean }>(MAT_DIALOG_DATA);
  documentService = inject(DocumentService);
  auditService = inject(AuditService);
  auth = inject(AuthService);
  printService = inject(PrintService);
  documentAccess = inject(DocumentAccessService);
  toast = inject(ToastService);
  barcodeService = inject(BarcodeService);
  dialog = inject(MatDialog);

  @ViewChild('barcodeSvg') barcodeSvg?: ElementRef<SVGSVGElement>;

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

  ngAfterViewInit(): void {
    this.renderBarcode();
  }

  private renderBarcode(): void {
    if (this.doc.barcode && this.barcodeSvg) {
      this.barcodeService.renderToElement(this.barcodeSvg.nativeElement, this.doc.barcode);
    }
  }

  async edit(): Promise<void> {
    const allowed = await this.documentAccess.verifyAccess(this.doc, 'edit');
    if (!allowed) return;

    const ref = this.dialog.open(DocumentFormComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true,
      data: { doc: this.doc }
    });
    ref.afterClosed().subscribe(async result => {
      if (!result || !this.doc.id) return;
      const updated = await this.documentService.getById(this.doc.id);
      if (updated) {
        this.doc = updated;
        this.attachments = this.documentService.parseAttachments(updated);
        this.renderBarcode();
      }
      this.toast.show('تم تحديث الوثيقة بنجاح', 'success');
    });
  }

  async openAttachment(att: Attachment): Promise<void> {
    const result = await window.electronAPI.openAttachment(att.base64, att.name, att.ext);
    if (!result.success) {
      console.error(result.message);
    }
  }

  async handlePrint(): Promise<void> {
    const allowed = await this.documentAccess.verifyAccess(this.doc, 'print');
    if (!allowed) {
      this.toast.show('تم رفض الوصول: يتطلب التحقق من الهوية لهذه الوثيقة', 'error');
      return;
    }
    await this.printService.printDocument(this.doc, this.folder, this.currentUser);
  }

  print(): void {
    void this.handlePrint();
  }

  async printLabel(): Promise<void> {
    const allowed = await this.documentAccess.verifyAccess(this.doc, 'print');
    if (!allowed) {
      this.toast.show('تم رفض الوصول: يتطلب التحقق من الهوية لهذه الوثيقة', 'error');
      return;
    }
    if (!this.doc.barcode) {
      this.toast.show('لا يوجد باركود لهذه الوثيقة', 'error');
      return;
    }
    this.printService.printBarcodeLabel(this.doc);
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
