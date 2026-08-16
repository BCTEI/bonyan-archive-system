import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OrgUnit, FlatOrgUnit, UNIT_TYPE_LABELS, buildOrgTree, flattenOrgTree } from '../../models/org-unit.model';
import { OrgUnitService } from '../../services/org-unit.service';
import { ToastService } from '../../services/toast.service';
import { OrgUnitFormComponent } from './org-unit-form/org-unit-form.component';

@Component({
  selector: 'app-org-unit-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule
  ],
  templateUrl: './org-unit-management.component.html',
  styleUrl: './org-unit-management.component.scss'
})
export class OrgUnitManagementComponent implements OnInit {
  private orgUnitService = inject(OrgUnitService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  units = signal<OrgUnit[]>([]);
  flatUnits = signal<FlatOrgUnit[]>([]);
  loading = signal(true);
  unitTypeLabels = UNIT_TYPE_LABELS;

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const units = await this.orgUnitService.getAll();
      this.units.set(units);
      this.flatUnits.set(flattenOrgTree(buildOrgTree(units)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل الهيكل التنظيمي';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  openForm(unit?: OrgUnit, parent?: OrgUnit): void {
    const ref = this.dialog.open(OrgUnitFormComponent, {
      width: '480px',
      maxWidth: '95vw',
      data: { unit, parentUnit: parent, allUnits: this.units() }
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadData();
    });
  }

  async toggleStatus(unit: OrgUnit): Promise<void> {
    const next = unit.is_active ? 0 : 1;
    const label = unit.is_active ? 'تعطيل' : 'تفعيل';
    try {
      await this.orgUnitService.update(unit.id, { is_active: next });
      this.toast.show(`تم ${label} الوحدة "${unit.name}" بنجاح`, 'success');
      await this.loadData();
    } catch (err: unknown) {
      this.toast.showError(err, 'فشل تغيير الحالة');
    }
  }

  async deleteUnit(unit: OrgUnit): Promise<void> {
    if (!confirm(`هل أنت متأكد من حذف الوحدة "${unit.name}"؟`)) return;
    try {
      await this.orgUnitService.delete(unit.id);
      this.toast.show('تم حذف الوحدة بنجاح', 'success');
      await this.loadData();
    } catch (err: unknown) {
      this.toast.showError(err, 'فشل حذف الوحدة');
    }
  }

  typeLabel(unit: OrgUnit): string {
    return this.unitTypeLabels[unit.unit_type];
  }

  hasChildren(unit: OrgUnit): boolean {
    return this.units().some(u => u.parent_id === unit.id);
  }
}
