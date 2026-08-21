import { Injectable } from '@angular/core';
import { MasterListEntry, MasterListInput, MasterListType } from '../models/master-list.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class MasterListService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(listType?: MasterListType, activeOnly = false): Promise<MasterListEntry[]> {
    const result = unwrap(await this.api.masterListAPI.getAll(listType, activeOnly), 'فشل تحميل القائمة الرئيسية');
    return result.items ?? [];
  }

  /** Loads the five master lists used across the app in one round of parallel IPC calls. */
  async loadAllLists(activeOnly = false): Promise<{ message_author: MasterListEntry[]; preparer: MasterListEntry[]; sender: MasterListEntry[]; receiver: MasterListEntry[]; department: MasterListEntry[] }> {
    const [message_author, preparer, sender, receiver, department] = await Promise.all([
      this.getAll('message_author', activeOnly),
      this.getAll('preparer', activeOnly),
      this.getAll('sender', activeOnly),
      this.getAll('receiver', activeOnly),
      this.getAll('department', activeOnly)
    ]);
    return { message_author, preparer, sender, receiver, department };
  }

  async create(input: MasterListInput): Promise<number> {
    const result = unwrap(await this.api.masterListAPI.create(input), 'فشل إضافة العنصر');
    return result.id!;
  }

  async update(id: number, input: Partial<MasterListInput>): Promise<void> {
    const result = unwrap(await this.api.masterListAPI.update(id, input), 'فشل تحديث العنصر');
  }

  async delete(id: number): Promise<void> {
    const result = unwrap(await this.api.masterListAPI.delete(id), 'فشل حذف العنصر');
  }

  async toggleStatus(id: number, isActive: number): Promise<void> {
    const result = unwrap(await this.api.masterListAPI.toggleStatus(id, isActive), 'فشل تغيير حالة العنصر');
  }
}
