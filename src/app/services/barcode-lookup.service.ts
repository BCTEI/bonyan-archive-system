import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DocumentService } from './document.service';
import { DocumentAccessService } from './document-access.service';
import { FolderService } from './folder.service';
import { ToastService } from './toast.service';
import { DocumentViewComponent } from '../components/document-view/document-view.component';

/**
 * Shared entry point for "resolve a barcode to a document and show its details" —
 * used both by a manual barcode search field and by the global scanner listener,
 * so a physical scan and a typed/pasted barcode land in the exact same flow as
 * opening a document from the grid (same access checks, same details dialog).
 */
@Injectable({
  providedIn: 'root'
})
export class BarcodeLookupService {
  private documentService = inject(DocumentService);
  private documentAccess = inject(DocumentAccessService);
  private folderService = inject(FolderService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  async openByBarcode(barcode: string): Promise<void> {
    const value = barcode.trim().normalize('NFC').replace(/[‎‏]/g, '');
    if (!value) return;

    try {
      const doc = await this.documentService.getByBarcode(value);
      if (!doc) {
        this.toast.show('لم يتم العثور على وثيقة بهذا الباركود', 'error');
        return;
      }

      const verified = await this.documentAccess.verifyAccess(doc, 'view');
      if (!verified) return;

      const folders = await this.folderService.getAll();
      this.dialog.open(DocumentViewComponent, {
        width: '850px',
        maxWidth: '95vw',
        data: { doc, folder: folders.find(f => f.id === doc.folder_id) }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل البحث عن الوثيقة';
      this.toast.show(message, 'error');
    }
  }
}
