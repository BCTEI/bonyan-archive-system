import { Injectable } from '@angular/core';
import { Folder } from '../models/folder.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class FolderService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(): Promise<Folder[]> {
    const result = unwrap(await this.api.folderCategoryAPI.getAll(true), 'فشل تحميل المجلدات');
    return result.folders ?? [];
  }

  async getAllWithCounts(): Promise<Folder[]> {
    const result = unwrap(await this.api.folderCategoryAPI.getAllWithCounts(), 'فشل تحميل المجلدات');
    return result.folders ?? [];
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
