import { Injectable } from '@angular/core';
import { DocumentTypeEntry } from '../models/document.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class DocumentTypeService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(activeOnly = false): Promise<DocumentTypeEntry[]> {
    const result = unwrap(await this.api.documentTypeAPI.getAll(activeOnly), 'فشل تحميل أنواع الوثائق');
    return result.types ?? [];
  }

  async getById(id: number): Promise<DocumentTypeEntry | undefined> {
    const result = unwrap(await this.api.documentTypeAPI.getById(id), 'فشل تحميل نوع الوثيقة');
    return result.type;
  }

  /** Per-type document counts, scoped server-side to the caller's visibility. */
  async getCounts(): Promise<Record<number, number>> {
    const result = unwrap(await this.api.documentTypeAPI.getCounts(), 'فشل تحميل إحصائيات الأنواع');
    return result.counts ?? {};
  }

  async create(data: Partial<DocumentTypeEntry>): Promise<number> {
    const result = unwrap(await this.api.documentTypeAPI.create(data), 'فشل إنشاء نوع الوثيقة');
    return result.id!;
  }

  async update(id: number, data: Partial<DocumentTypeEntry>): Promise<void> {
    const result = unwrap(await this.api.documentTypeAPI.update(id, data), 'فشل تحديث نوع الوثيقة');
  }

  async delete(id: number): Promise<void> {
    const result = unwrap(await this.api.documentTypeAPI.delete(id), 'فشل حذف نوع الوثيقة');
  }
}
