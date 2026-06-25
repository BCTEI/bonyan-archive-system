import { Injectable } from '@angular/core';
import { MasterListEntry, MasterListInput, MasterListType } from '../models/master-list.model';

@Injectable({
  providedIn: 'root'
})
export class MasterListService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(listType?: MasterListType, activeOnly = false): Promise<MasterListEntry[]> {
    const result = await this.api.masterListAPI.getAll(listType, activeOnly);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل القائمة الرئيسية');
    return result.items ?? [];
  }

  async create(input: MasterListInput): Promise<number> {
    const result = await this.api.masterListAPI.create(input);
    if (!result.success) throw new Error(result.error ?? 'فشل إضافة العنصر');
    return result.id!;
  }

  async update(id: number, input: Partial<MasterListInput>): Promise<void> {
    const result = await this.api.masterListAPI.update(id, input);
    if (!result.success) throw new Error(result.error ?? 'فشل تحديث العنصر');
  }

  async delete(id: number): Promise<void> {
    const result = await this.api.masterListAPI.delete(id);
    if (!result.success) throw new Error(result.error ?? 'فشل حذف العنصر');
  }

  async toggleStatus(id: number, isActive: number): Promise<void> {
    const result = await this.api.masterListAPI.toggleStatus(id, isActive);
    if (!result.success) throw new Error(result.error ?? 'فشل تغيير حالة العنصر');
  }
}
