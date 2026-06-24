import { Injectable } from '@angular/core';
import { ArchiveDocument, Attachment } from '../models/document.model';

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(): Promise<ArchiveDocument[]> {
    const result = await this.api.documentAPI.getAll();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الوثائق');
    return result.documents ?? [];
  }

  async getById(id: number): Promise<ArchiveDocument | undefined> {
    const result = await this.api.documentAPI.getById(id);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الوثيقة');
    return result.document;
  }

  async create(doc: ArchiveDocument): Promise<number> {
    const result = await this.api.documentAPI.create(doc);
    if (!result.success) throw new Error(result.error ?? 'فشل إنشاء الوثيقة');
    return result.id!;
  }

  async update(doc: ArchiveDocument): Promise<void> {
    const result = await this.api.documentAPI.update(doc);
    if (!result.success) throw new Error(result.error ?? 'فشل تحديث الوثيقة');
  }

  async delete(id: number): Promise<void> {
    const result = await this.api.documentAPI.delete(id);
    if (!result.success) throw new Error(result.error ?? 'فشل حذف الوثيقة');
  }

  async getNextRef(typeId: number, folderId: number): Promise<string> {
    return this.api.getNextRef(typeId, folderId);
  }

  parseAttachments(doc: ArchiveDocument): Attachment[] {
    try {
      return JSON.parse(doc.attachments_json) as Attachment[];
    } catch {
      return [];
    }
  }
}
