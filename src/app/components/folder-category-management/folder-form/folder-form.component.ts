import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Folder, FolderInput } from '../../../models/folder.model';
import { FolderCategoryService } from '../../../services/folder-category.service';
import { ToastService } from '../../../services/toast.service';

const NEW_GROUP_VALUE = '__NEW__';

@Component({
  selector: 'app-folder-form',
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
  templateUrl: './folder-form.component.html',
  styleUrl: './folder-form.component.scss'
})
export class FolderFormComponent {
  private dialogRef = inject(MatDialogRef<FolderFormComponent>);
  private data = inject<{ folder?: Folder; groups: string[] }>(MAT_DIALOG_DATA);
  private folderService = inject(FolderCategoryService);
  private toast = inject(ToastService);

  readonly NEW_GROUP_VALUE = NEW_GROUP_VALUE;

  folder = this.data.folder;
  isEdit = !!this.folder;
  existingGroups = this.data.groups ?? [];

  name = signal(this.folder?.name ?? '');
  group = signal(this.folder?.group_name ?? (this.existingGroups[0] || ''));
  isNewGroup = signal(!this.folder?.group_name && this.existingGroups.length === 0);
  newGroupName = signal('');
  isActive = signal((this.folder?.is_active ?? 1) === 1);

  loading = signal(false);
  errors = signal<Record<string, string>>({});

  get finalGroupName(): string {
    if (this.isNewGroup()) {
      return this.newGroupName().trim();
    }
    return this.group().trim();
  }

  onGroupChange(value: string): void {
    this.isNewGroup.set(value === NEW_GROUP_VALUE);
    this.group.set(value);
  }

  async save(): Promise<void> {
    this.errors.set({});
    const payload: FolderInput = {
      name: this.name().trim(),
      group_name: this.finalGroupName,
      is_active: this.isActive() ? 1 : 0
    };

    const validation = this.validate(payload);
    if (validation) {
      this.errors.set(validation);
      return;
    }

    try {
      this.loading.set(true);
      // Main process logs the audit entry for create/update — no renderer-side log.
      if (this.isEdit && this.folder?.id) {
        await this.folderService.update(this.folder.id, payload);
        this.toast.show('تم تحديث التصنيف بنجاح', 'success');
      } else {
        await this.folderService.create(payload);
        this.toast.show('تم إنشاء التصنيف بنجاح', 'success');
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ غير معروف';
      this.toast.showError(err, 'خطأ غير معروف');
      this.parseErrors(message);
    } finally {
      this.loading.set(false);
    }
  }

  private validate(payload: FolderInput): Record<string, string> | null {
    const map: Record<string, string> = {};
    if (!payload.name) {
      map['name'] = 'اسم التصنيف مطلوب';
    }
    if (!payload.group_name) {
      map['group'] = 'اسم المجموعة مطلوب';
    }
    return Object.keys(map).length ? map : null;
  }

  private parseErrors(message: string): void {
    const map: Record<string, string> = {};
    if (message.includes('اسم التصنيف')) map['name'] = message;
    if (message.includes('المجموعة')) map['group'] = message;
    this.errors.set(map);
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
