import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ArchiveDocument } from '../models/document.model';
import { SecurityModalComponent } from '../components/security-modal/security-modal.component';

export type DocumentAction = 'view' | 'edit' | 'print' | 'delete';

@Injectable({
  providedIn: 'root'
})
export class DocumentAccessService {
  private dialog = inject(MatDialog);

  /**
   * Ensures the current user is allowed to perform an action on a document.
   * Normal documents pass immediately.
   * "سري" and "سري للغاية" documents ALWAYS show the security modal,
   * for every action (view / edit / print / delete).
   */
  async verifyAccess(doc: ArchiveDocument, action: DocumentAction): Promise<boolean> {
    if (doc.confidentiality === 'عادي') return true;

    const ref = this.dialog.open(SecurityModalComponent, {
      width: '480px',
      maxWidth: '95vw',
      disableClose: true,
      data: { doc, action }
    });

    return new Promise<boolean>(resolve => {
      ref.afterClosed().subscribe(result => {
        resolve(result?.verified === true);
      });
    });
  }

  /**
   * Kept for API compatibility (called by AuthService on logout).
   * No cache is used: verification is always required.
   */
  clearCache(): void {
    // No-op: verification is always required for سري / سري للغاية documents.
  }
}
