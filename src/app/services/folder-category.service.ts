import { Injectable } from '@angular/core';
import { Folder, FolderInput } from '../models/folder.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class FolderCategoryService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(activeOnly = false): Promise<Folder[]> {
    const result = unwrap(await this.api.folderCategoryAPI.getAll(activeOnly), 'فشل تحميل التصنيفات');
    return result.folders ?? [];
  }

  async getGroups(): Promise<string[]> {
    const result = unwrap(await this.api.folderCategoryAPI.getGroups(), 'فشل تحميل المجموعات');
    return result.groups ?? [];
  }

  async getById(id: number): Promise<Folder | undefined> {
    const result = unwrap(await this.api.folderCategoryAPI.getById(id), 'فشل تحميل التصنيف');
    return result.folder;
  }

  async create(data: FolderInput): Promise<number> {
    const result = unwrap(await this.api.folderCategoryAPI.create(data), 'فشل إنشاء التصنيف');
    return result.id!;
  }

  async update(id: number, data: Partial<FolderInput>): Promise<void> {
    const result = unwrap(await this.api.folderCategoryAPI.update(id, data), 'فشل تحديث التصنيف');
  }

  async delete(id: number): Promise<void> {
    const result = unwrap(await this.api.folderCategoryAPI.delete(id), 'فشل حذف التصنيف');
  }
}
