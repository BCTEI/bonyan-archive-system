import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { Folder } from '../models/folder.model';

@Injectable({
  providedIn: 'root'
})
export class FolderService {
  constructor(private db: DatabaseService) {}

  async getAll(): Promise<Folder[]> {
    return this.db.getFolders();
  }

  async getAllWithCounts(): Promise<Folder[]> {
    const folders = await this.db.getFolders();
    const counts = await this.db.query<{ folder_id: number; c: number }>(
      'SELECT folder_id, COUNT(*) as c FROM documents GROUP BY folder_id'
    );
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
