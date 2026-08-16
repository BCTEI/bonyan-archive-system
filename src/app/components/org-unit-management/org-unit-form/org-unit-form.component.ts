import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { OrgUnit, OrgUnitInput, FlatOrgUnit, UNIT_TYPE_LABELS, buildOrgTree, flattenOrgTree } from '../../../models/org-unit.model';
import { OrgUnitService } from '../../../services/org-unit.service';
import { ToastService } from '../../../services/toast.service';

const NO_PARENT_VALUE = '__NONE__';

@Component({
  selector: 'app-org-unit-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule
  ],
  templateUrl: './org-unit-form.component.html',
  styleUrl: './org-unit-form.component.scss'
})
export class OrgUnitFormComponent {
  private dialogRef = inject(MatDialogRef<OrgUnitFormComponent>);
  private data = inject<{ unit?: OrgUnit; parentUnit?: OrgUnit; allUnits: OrgUnit[] }>(MAT_DIALOG_DATA);
  private orgUnitService = inject(OrgUnitService);
  private toast = inject(ToastService);

  readonly NO_PARENT_VALUE = NO_PARENT_VALUE;
  readonly unitTypeLabels = UNIT_TYPE_LABELS;

  unit = this.data.unit;
  isEdit = !!this.unit;
  allUnits = this.data.allUnits ?? [];

  name = signal(this.unit?.name ?? '');
  unitType = signal<OrgUnit['unit_type']>(this.unit?.unit_type ?? (this.data.parentUnit ? 'section' : 'administration'));
  parentId = signal<number | typeof NO_PARENT_VALUE>(this.unit?.parent_id ?? this.data.parentUnit?.id ?? NO_PARENT_VALUE);
  isActive = signal((this.unit?.is_active ?? 1) === 1);

  loading = signal(false);
  errors = signal<Record<string, string>>({});

  /** Depth-indented parent options, excluding the unit being edited and its own subtree (no cycles). */
  parentOptions = computed<FlatOrgUnit[]>(() => {
    const excluded = this.unit ? this.subtreeIds(this.unit.id) : new Set<number>();
    const selectable = this.allUnits.filter(u => !excluded.has(u.id));
    return flattenOrgTree(buildOrgTree(selectable));
  });

  private subtreeIds(rootId: number): Set<number> {
    const ids = new Set<number>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const u of this.allUnits) {
        if (u.parent_id !== null && ids.has(u.parent_id) && !ids.has(u.id)) {
          ids.add(u.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  async save(): Promise<void> {
    this.errors.set({});
    const parent = this.parentId();
    const payload: OrgUnitInput = {
      name: this.name().trim(),
      unit_type: this.unitType(),
      parent_id: parent === NO_PARENT_VALUE ? null : parent,
      is_active: this.isActive() ? 1 : 0
    };

    if (!payload.name) {
      this.errors.set({ name: 'اسم الوحدة مطلوب' });
      return;
    }

    try {
      this.loading.set(true);
      // Main process logs the audit entry for create/update — no renderer-side log.
      if (this.isEdit && this.unit?.id) {
        await this.orgUnitService.update(this.unit.id, payload);
        this.toast.show('تم تحديث الوحدة التنظيمية بنجاح', 'success');
      } else {
        await this.orgUnitService.create(payload);
        this.toast.show('تم إنشاء الوحدة التنظيمية بنجاح', 'success');
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ غير معروف';
      this.toast.showError(err, 'خطأ غير معروف');
      this.errors.set({ name: message });
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
