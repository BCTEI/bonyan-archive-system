import { Injectable } from '@angular/core';
import { ArchivedYear } from '../models/annual-closing.model';
import { ArchiveDocument } from '../models/document.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class AnnualClosingService {
  private get api() {
    return window.electronAPI;
  }

  async getArchivedYears(): Promise<ArchivedYear[]> {
    const result = unwrap(await this.api.annualClosingAPI.getArchivedYears(), 'فشل تحميل السنوات المؤرشفة');
    return result.years ?? [];
  }

  // Current archive year is tracked independently of the OS clock — it
  // advances the moment a year is closed, not when the calendar rolls over.
  async getCurrentArchiveYear(): Promise<{ year: number; sequence: number }> {
    const result = unwrap(await this.api.annualClosingAPI.getCurrentArchiveYear(), 'فشل تحميل السنة الحالية للأرشيف');
    return { year: result.year!, sequence: result.sequence! };
  }

  async closeYear(year: number): Promise<{ message: string; backupPath?: string }> {
    const result = unwrap(await this.api.annualClosingAPI.closeYear(year), 'فشل إغلاق السنة');
    return { message: result.message!, backupPath: result.backupPath };
  }

  // List view: rows come back WITHOUT body/attachments_json/signature_base64
  // (see electron/database.ts getArchivedDocuments) but WITH an attachments_count
  // shim — callers needing full content must fetch by id via getArchivedDocumentById.
  async getArchivedDocuments(year: number): Promise<ArchiveDocument[]> {
    const result = unwrap(await this.api.annualClosingAPI.getArchivedDocuments(year), 'فشل تحميل الوثائق المؤرشفة');
    return (result.documents ?? []) as ArchiveDocument[];
  }

  // Detail view: full row. If the doc is سري للغاية and unverified under scope
  // `archive:<year>:<id>`, the main process returns it stripped (body/attachments
  // removed) — the caller must run DocumentAccessService.verifyAccess with scope
  // `archive:<year>` first.
  async getArchivedDocumentById(year: number, id: number): Promise<ArchiveDocument | undefined> {
    const result = unwrap(await this.api.annualClosingAPI.getArchivedDocumentById(year, id), 'فشل تحميل الوثيقة المؤرشفة');
    return result.document as ArchiveDocument | undefined;
  }
}
