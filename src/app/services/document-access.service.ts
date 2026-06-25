import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ArchiveDocument } from '../models/document.model';
import { SecurityModalComponent } from '../components/security-modal/security-modal.component';

export type DocumentAction = 'view' | 'edit' | 'print';

@Injectable({
  providedIn: 'root'
})
export class DocumentAccessService {
  private dialog = inject(MatDialog);

  // Cache documents verified in the current session so the user is not
  // prompted repeatedly for view/print/edit of the same secret document.
  private verifiedDocs = new Set<number>();

  /**
   * Ensures the current user is allowed to perform an action on a document.
   * Normal documents pass immediately. Secret documents show the security
   * modal once per session.
   */
  async verifyAccess(doc: ArchiveDocument, action: DocumentAction): Promise<boolean> {
    if (doc.confidentiality === 'عادي') return true;
    if (doc.id !== undefined && this.verifiedDocs.has(doc.id)) return true;

    const ref = this.dialog.open(SecurityModalComponent, {
      width: '480px',
      maxWidth: '95vw',
      disableClose: true,
      data: { doc, accessType: action === 'edit' ? 'edit' : 'view' }
    });

    return new Promise<boolean>(resolve => {
      ref.afterClosed().subscribe(result => {
        const verified = result?.verified === true;
        if (verified && doc.id !== undefined) {
          this.verifiedDocs.add(doc.id);
        }
        resolve(verified);
      });
    });
  }

  /**
   * Clears the verification cache. Should be called on logout.
   */
  clearCache(): void {
    this.verifiedDocs.clear();
  }
}
