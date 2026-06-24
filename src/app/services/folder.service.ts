import { Injectable } from '@angular/core';
import { Folder } from '../models/folder.model';

@Injectable({
  providedIn: 'root'
})
export class FolderService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(): Promise<Folder[]> {
    const result = await this.api.folderCategoryAPI.getAll(true);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل المجلدات');
    return result.folders ?? [];
  }

  async getAllWithCounts(): Promise<Folder[]> {
    const folders = await this.getAll();
    const counts = await this.api.dbQuery(
      'SELECT folder_id, COUNT(*) as c FROM documents GROUP BY folder_id'
    ) as Array<{ folder_id: number; c: number }>;
    const map = new Map(counts.map(c => [c.folder_id, c.c]));
    return folders.map(f => ({ ...f, document_count: map.get(f.id) ?? 0 }));
  }

  groupByGroupName(folders: Folder[]): Map<string, Folder[]> {
    const map = new Map<string, Folder[]>();
    for (const folder of folders) {
      if (!map.has(folder.group_name)) {
        map.set(folder.group_name, []);
      }
      map.get(folder.group_name)!.push(folder);
    }
    return map;
  }
}
