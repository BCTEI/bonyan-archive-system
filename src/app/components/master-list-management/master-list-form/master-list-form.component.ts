import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MasterListService } from '../../../services/master-list.service';
import { ToastService } from '../../../services/toast.service';
import { MasterListEntry, MasterListType } from '../../../models/master-list.model';

@Component({
  selector: 'app-master-list-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './master-list-form.component.html',
  styleUrl: './master-list-form.component.scss'
})
export class MasterListFormComponent {
  private dialogRef = inject(MatDialogRef<MasterListFormComponent>);
  private data = inject<{ item?: MasterListEntry; listType?: MasterListType }>(MAT_DIALOG_DATA);
  private masterListService = inject(MasterListService);
  private toast = inject(ToastService);

  item = this.data?.item;
  listType = this.data?.listType ?? 'author';
  name = signal(this.item?.name ?? '');
  isSaving = signal(false);

  title(): string {
    return this.item ? 'تعديل عنصر' : 'إضافة عنصر جديد';
  }

  typeLabel(): string {
    switch (this.listType) {
      case 'author': return 'مؤلف';
      case 'sender': return 'جهة مرسلة';
      case 'receiver': return 'جهة مستقبلة';
      case 'department': return 'قسم';
      default: return 'عنصر';
    }
  }

  async save(): Promise<void> {
    const value = this.name().trim();
    if (!value) {
      this.toast.show('الاسم مطلوب', 'warning');
      return;
    }

    this.isSaving.set(true);
    try {
      if (this.item) {
        await this.masterListService.update(this.item.id, { name: value });
      } else {
        await this.masterListService.create({ list_type: this.listType, name: value });
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      this.toast.show(message, 'error');
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
