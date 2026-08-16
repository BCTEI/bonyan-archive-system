import { Injectable } from '@angular/core';
import { ArchiveDocument, Attachment } from '../models/document.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(): Promise<ArchiveDocument[]> {
    const result = unwrap(await this.api.documentAPI.getAll(), 'فشل تحميل الوثائق');
    return result.documents ?? [];
  }

  async getById(id: number): Promise<ArchiveDocument | undefined> {
    const result = unwrap(await this.api.documentAPI.getById(id), 'فشل تحميل الوثيقة');
    return result.document;
  }

  async getByBarcode(barcode: string): Promise<ArchiveDocument | undefined> {
    const result = unwrap(await this.api.documentAPI.getByBarcode(barcode), 'لم يتم العثور على وثيقة بهذا الباركود');
    return result.document;
  }

  async create(doc: ArchiveDocument): Promise<{ id: number; ref_number: string }> {
    const result = unwrap(await this.api.documentAPI.create(doc), 'فشل إنشاء الوثيقة');
    return { id: result.id!, ref_number: result.ref_number! };
  }

  async update(doc: ArchiveDocument): Promise<void> {
    const result = unwrap(await this.api.documentAPI.update(doc), 'فشل تحديث الوثيقة');
  }

  /**
   * Non-destructive "delete": the main process marks the document as
   * suspended (موقوف) instead of removing the row. Archive history,
   * reference number and attachments are always preserved.
   */
  async suspend(id: number): Promise<void> {
    const result = unwrap(await this.api.documentAPI.delete(id), 'فشل إيقاف الوثيقة');
  }

  parseAttachments(doc: ArchiveDocument): Attachment[] {
    try {
      return JSON.parse(doc.attachments_json) as Attachment[];
    } catch {
      return [];
    }
  }
}
