import { Injectable } from '@angular/core';
import { DocumentTypeEntry } from '../models/document.model';

@Injectable({
  providedIn: 'root'
})
export class DocumentTypeService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(activeOnly = false): Promise<DocumentTypeEntry[]> {
    const result = await this.api.documentTypeAPI.getAll(activeOnly);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل أنواع الوثائق');
    return result.types ?? [];
  }

  async getById(id: number): Promise<DocumentTypeEntry | undefined> {
    const result = await this.api.documentTypeAPI.getById(id);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل نوع الوثيقة');
    return result.type;
  }

  async create(data: Partial<DocumentTypeEntry>): Promise<number> {
    const result = await this.api.documentTypeAPI.create(data);
    if (!result.success) throw new Error(result.error ?? 'فشل إنشاء نوع الوثيقة');
    return result.id!;
  }

  async update(id: number, data: Partial<DocumentTypeEntry>): Promise<void> {
    const result = await this.api.documentTypeAPI.update(id, data);
    if (!result.success) throw new Error(result.error ?? 'فشل تحديث نوع الوثيقة');
  }

  async delete(id: number): Promise<void> {
    const result = await this.api.documentTypeAPI.delete(id);
    if (!result.success) throw new Error(result.error ?? 'فشل حذف نوع الوثيقة');
  }
}
