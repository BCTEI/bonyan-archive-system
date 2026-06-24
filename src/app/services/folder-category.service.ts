import { Injectable } from '@angular/core';
import { Folder, FolderInput } from '../models/folder.model';

@Injectable({
  providedIn: 'root'
})
export class FolderCategoryService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(activeOnly = false): Promise<Folder[]> {
    const result = await this.api.folderCategoryAPI.getAll(activeOnly);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل التصنيفات');
    return result.folders ?? [];
  }

  async getGroups(): Promise<string[]> {
    const result = await this.api.folderCategoryAPI.getGroups();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل المجموعات');
    return result.groups ?? [];
  }

  async getById(id: number): Promise<Folder | undefined> {
    const result = await this.api.folderCategoryAPI.getById(id);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل التصنيف');
    return result.folder;
  }

  async create(data: FolderInput): Promise<number> {
    const result = await this.api.folderCategoryAPI.create(data);
    if (!result.success) throw new Error(result.error ?? 'فشل إنشاء التصنيف');
    return result.id!;
  }

  async update(id: number, data: Partial<FolderInput>): Promise<void> {
    const result = await this.api.folderCategoryAPI.update(id, data);
    if (!result.success) throw new Error(result.error ?? 'فشل تحديث التصنيف');
  }

  async delete(id: number): Promise<void> {
    const result = await this.api.folderCategoryAPI.delete(id);
    if (!result.success) throw new Error(result.error ?? 'فشل حذف التصنيف');
  }
}
