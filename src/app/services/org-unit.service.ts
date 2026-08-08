import { Injectable } from '@angular/core';
import { OrgUnit, OrgUnitInput, OrgUnitNode, FlatOrgUnit, buildOrgTree, flattenOrgTree } from '../models/org-unit.model';

@Injectable({
  providedIn: 'root'
})
export class OrgUnitService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(activeOnly = false): Promise<OrgUnit[]> {
    const result = await this.api.orgUnitAPI.getAll(activeOnly);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الوحدات التنظيمية');
    return result.units ?? [];
  }

  async getTree(activeOnly = false): Promise<OrgUnitNode[]> {
    const units = await this.getAll(activeOnly);
    return buildOrgTree(units);
  }

  /** Depth-indented flat list, ready for rendering as <mat-select> options. */
  async getFlatTree(activeOnly = false): Promise<FlatOrgUnit[]> {
    return flattenOrgTree(await this.getTree(activeOnly));
  }

  async create(data: OrgUnitInput): Promise<number> {
    const result = await this.api.orgUnitAPI.create(data);
    if (!result.success) throw new Error(result.error ?? 'فشل إنشاء الوحدة التنظيمية');
    return result.id!;
  }

  async update(id: number, data: Partial<OrgUnitInput>): Promise<void> {
    const result = await this.api.orgUnitAPI.update(id, data);
    if (!result.success) throw new Error(result.error ?? 'فشل تحديث الوحدة التنظيمية');
  }

  async delete(id: number): Promise<void> {
    const result = await this.api.orgUnitAPI.delete(id);
    if (!result.success) throw new Error(result.error ?? 'فشل حذف الوحدة التنظيمية');
  }
}
