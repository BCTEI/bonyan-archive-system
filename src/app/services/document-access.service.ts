import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ArchiveDocument } from '../models/document.model';
import { SecurityModalComponent } from '../components/security-modal/security-modal.component';
import { DocumentService } from './document.service';
import { ToastService } from './toast.service';

export type DocumentAction = 'view' | 'edit' | 'print';

@Injectable({
  providedIn: 'root'
})
export class DocumentAccessService {
  private dialog = inject(MatDialog);
  private documentService = inject(DocumentService);
  private toast = inject(ToastService);

  // Cache documents verified in the current session so the user is not
  // prompted repeatedly for view/print/edit of the same secret document.
  // Keyed `${scope}:${doc.id}` to match the main process's verifiedTopSecret
  // set (electron/main.ts) — scope distinguishes the live archive from a
  // future closed-year archive browser so unlocking a document in one scope
  // never leaks into the other.
  private verifiedDocs = new Set<string>();

  /**
   * Ensures the current user is allowed to perform an action on a document.
   * Normal documents pass immediately. Secret documents show the security
   * modal once per session (per scope).
   */
  async verifyAccess(doc: ArchiveDocument, action: DocumentAction, scope: string = 'live'): Promise<boolean> {
    if (doc.confidentiality === 'عادي') return true;

    const key = doc.id !== undefined ? `${scope}:${doc.id}` : undefined;
    if (key !== undefined && this.verifiedDocs.has(key)) {
      // Already verified this session, but the `doc` instance handed to us
      // this time may be a freshly reloaded, still-stripped object (e.g. the
      // grid reloaded its list after an edit) — re-cover it every time. If the
      // re-fetch fails, fail closed: do NOT tell the caller it's safe to render
      // a still-stripped top-secret doc as "unlocked".
      return this.refreshTopSecretDoc(doc);
    }

    const ref = this.dialog.open(SecurityModalComponent, {
      width: '480px',
      maxWidth: '95vw',
      disableClose: true,
      data: { doc, accessType: action === 'edit' ? 'edit' : 'view', scope }
    });

    return new Promise<boolean>(resolve => {
      ref.afterClosed().subscribe(async result => {
        const verified = result?.verified === true;
        if (!verified) {
          resolve(false);
          return;
        }

        // The password/code was already verified (and, for the code step,
        // already consumed server-side) at this point. If the follow-up
        // re-fetch of the full document fails, fail closed: don't cache this
        // key as verified and don't tell the caller it's safe to proceed —
        // the caller must not render a still-stripped top-secret doc as
        // unlocked. The user simply retries (a fresh code, since the old one
        // is burned); that's an acceptable cost of a transient failure.
        const refreshed = await this.refreshTopSecretDoc(doc);
        if (refreshed && key !== undefined) {
          this.verifiedDocs.add(key);
        }
        resolve(refreshed);
      });
    });
  }

  /**
   * The main process strips body/attachments/signature from سري للغاية rows
   * unless this session already unlocked them (applyTopSecretGate in
   * electron/main.ts). documentAPI.getAll()-sourced doc objects are stripped;
   * once verification succeeds we must re-fetch the full row by id so callers
   * (document-grid, document-view) render the real content instead of the
   * stripped placeholder. Mutates `doc` in place so every holder of this
   * object reference (grid row, open dialog) sees the refreshed fields.
   *
   * Returns whether the doc is safe to treat as unlocked: true immediately for
   * non-top-secret docs (nothing to refresh), true once the refresh succeeds,
   * false — with a toast — if the refresh fails. Callers MUST treat a false
   * return as "access denied for this attempt", not as a successful verify
   * that merely left stale content on screen.
   */
  private async refreshTopSecretDoc(doc: ArchiveDocument): Promise<boolean> {
    if (doc.confidentiality !== 'سري للغاية' || doc.id === undefined) return true;
    try {
      const fresh = await this.documentService.getById(doc.id);
      if (!fresh) throw new Error('الوثيقة غير موجودة');
      Object.assign(doc, fresh);
      return true;
    } catch {
      this.toast.show('تعذر تحميل محتوى الوثيقة، حاول مرة أخرى', 'error');
      return false;
    }
  }

  /**
   * Clears the verification cache. Should be called on logout.
   */
  clearCache(): void {
    this.verifiedDocs.clear();
  }
}
