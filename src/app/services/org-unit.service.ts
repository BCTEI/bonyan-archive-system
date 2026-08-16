import { Injectable } from '@angular/core';
import { OrgUnit, OrgUnitInput, OrgUnitNode, FlatOrgUnit, buildOrgTree, flattenOrgTree } from '../models/org-unit.model';
import { unwrap } from '../utils/ipc-result.util';

@Injectable({
  providedIn: 'root'
})
export class OrgUnitService {
  private get api() {
    return window.electronAPI;
  }

  async getAll(activeOnly = false): Promise<OrgUnit[]> {
    const result = unwrap(await this.api.orgUnitAPI.getAll(activeOnly), 'فشل تحميل الوحدات التنظيمية');
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
    const result = unwrap(await this.api.orgUnitAPI.create(data), 'فشل إنشاء الوحدة التنظيمية');
    return result.id!;
  }

  async update(id: number, data: Partial<OrgUnitInput>): Promise<void> {
    const result = unwrap(await this.api.orgUnitAPI.update(id, data), 'فشل تحديث الوحدة التنظيمية');
  }

  async delete(id: number): Promise<void> {
    const result = unwrap(await this.api.orgUnitAPI.delete(id), 'فشل حذف الوحدة التنظيمية');
  }
}
