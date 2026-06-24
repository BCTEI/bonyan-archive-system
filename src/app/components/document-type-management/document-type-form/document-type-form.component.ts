import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DocumentTypeEntry } from '../../../models/document.model';
import { DocumentTypeService } from '../../../services/document-type.service';
import { ToastService } from '../../../services/toast.service';
import { AuditService } from '../../../services/audit.service';

interface FormData {
  type?: DocumentTypeEntry;
  types: DocumentTypeEntry[];
}

@Component({
  selector: 'app-document-type-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './document-type-form.component.html',
  styleUrl: './document-type-form.component.scss'
})
export class DocumentTypeFormComponent {
  private dialogRef = inject(MatDialogRef<DocumentTypeFormComponent>);
  private data = inject<FormData>(MAT_DIALOG_DATA);
  private documentTypeService = inject(DocumentTypeService);
  private toast = inject(ToastService);
  private audit = inject(AuditService);

  type = this.data.type;
  isEdit = !!this.type;
  existingTypes = this.data.types ?? [];

  name = signal(this.type?.name ?? '');
  label = signal(this.type?.label ?? '');
  icon = signal(this.type?.icon ?? '📄');
  color = signal(this.type?.color ?? '#2563eb');
  prefix = signal(this.type?.prefix ?? '');

  loading = signal(false);
  errors = signal<Record<string, string>>({});

  onPrefixInput(value: string): void {
    this.prefix.set(value.toUpperCase());
  }

  async save(): Promise<void> {
    this.errors.set({});

    const payload: Partial<DocumentTypeEntry> = {
      name: this.name().trim(),
      label: this.label().trim(),
      icon: this.icon().trim(),
      color: this.color(),
      prefix: this.prefix().trim()
    };

    const validation = this.validate(payload);
    if (validation) {
      this.errors.set(validation);
      return;
    }

    try {
      this.loading.set(true);
      if (this.isEdit && this.type?.id) {
        await this.documentTypeService.update(this.type.id, payload);
        this.toast.show('تم تحديث نوع الوثيقة بنجاح', 'success');
        await this.audit.log('تعديل نوع وثيقة', this.type.prefix, `الاسم: ${payload.label}`);
      } else {
        const id = await this.documentTypeService.create(payload);
        this.toast.show('تم إنشاء نوع الوثيقة بنجاح', 'success');
        await this.audit.log('إنشاء نوع وثيقة', payload.prefix, `الاسم: ${payload.label} (معرف: ${id})`);
      }
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ غير معروف';
      this.toast.show(message, 'error');
      this.parseErrors(message);
    } finally {
      this.loading.set(false);
    }
  }

  private validate(payload: Partial<DocumentTypeEntry>): Record<string, string> | null {
    const map: Record<string, string> = {};

    if (!payload.name) {
      map['name'] = 'الاسم الداخلي مطلوب';
    }
    if (!payload.label) {
      map['label'] = 'الاسم المعروض مطلوب';
    }
    if (!payload.icon) {
      map['icon'] = 'الأيقونة مطلوبة';
    }
    if (!payload.color) {
      map['color'] = 'اللون مطلوب';
    }
    if (!payload.prefix) {
      map['prefix'] = 'البادئة مطلوبة';
    } else if (!/^[A-Z]{1,3}$/.test(payload.prefix)) {
      map['prefix'] = 'البادئة يجب أن تكون 1 إلى 3 أحرف إنجليزية كبيرة';
    } else {
      const duplicate = this.existingTypes.find(
        t => t.prefix === payload.prefix && t.id !== this.type?.id
      );
      if (duplicate) {
        map['prefix'] = 'البادئة مستخدمة مسبقاً';
      }
    }

    return Object.keys(map).length ? map : null;
  }

  private parseErrors(message: string): void {
    const map: Record<string, string> = {};
    if (message.includes('البادئة')) map['prefix'] = message;
    if (message.includes('مكتملة')) {
      if (!this.name().trim()) map['name'] = 'هذا الحقل مطلوب';
      if (!this.label().trim()) map['label'] = 'هذا الحقل مطلوب';
      if (!this.prefix().trim()) map['prefix'] = 'هذا الحقل مطلوب';
    }
    this.errors.set(map);
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
