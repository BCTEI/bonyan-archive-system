import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Folder } from '../../models/folder.model';
import { FolderCategoryService } from '../../services/folder-category.service';
import { ToastService } from '../../services/toast.service';
import { AuditService } from '../../services/audit.service';
import { FolderFormComponent } from './folder-form/folder-form.component';

interface FolderGroup {
  name: string;
  folders: Folder[];
}

@Component({
  selector: 'app-folder-category-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltipModule
  ],
  templateUrl: './folder-category-management.component.html',
  styleUrl: './folder-category-management.component.scss'
})
export class FolderCategoryManagementComponent implements OnInit {
  private folderService = inject(FolderCategoryService);
  private toast = inject(ToastService);
  private audit = inject(AuditService);
  private dialog = inject(MatDialog);

  folders = signal<Folder[]>([]);
  groups = signal<string[]>([]);
  groupedFolders = signal<FolderGroup[]>([]);
  loading = signal(true);

  displayedColumns = ['index', 'name', 'status', 'type', 'documents', 'actions'];

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [folders, groups] = await Promise.all([
        this.folderService.getAll(),
        this.folderService.getGroups()
      ]);
      this.folders.set(folders);
      this.groups.set(groups);
      this.buildGroups(folders);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل التصنيفات';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  private buildGroups(folders: Folder[]): void {
    const map = new Map<string, Folder[]>();
    for (const folder of folders) {
      const key = folder.group_name || 'بدون مجموعة';
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(folder);
    }
    const grouped: FolderGroup[] = [];
    for (const [name, items] of map.entries()) {
      grouped.push({ name, folders: items });
    }
    this.groupedFolders.set(grouped);
  }

  openForm(folder?: Folder): void {
    const ref = this.dialog.open(FolderFormComponent, {
      width: '520px',
      maxWidth: '95vw',
      data: { folder, groups: this.groups() }
    });
    ref.afterClosed().subscribe(result => {
      if (result) {
        this.loadData();
      }
    });
  }

  async toggleStatus(folder: Folder): Promise<void> {
    if (!folder.id) return;
    const next = folder.is_active ? 0 : 1;
    const label = folder.is_active ? 'تعطيل' : 'تفعيل';
    try {
      await this.folderService.update(folder.id, { is_active: next });
      this.toast.show(`تم ${label} التصنيف "${folder.name}" بنجاح`, 'success');
      await this.audit.log(`${label} تصنيف مجلد`, folder.name, `المجموعة: ${folder.group_name}`);
      await this.loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تغيير الحالة';
      this.toast.show(message, 'error');
    }
  }

  async deleteFolder(folder: Folder): Promise<void> {
    if (!folder.id) return;
    if (!confirm(`هل أنت متأكد من حذف التصنيف "${folder.name}"؟`)) return;
    try {
      await this.folderService.delete(folder.id);
      this.toast.show('تم حذف التصنيف بنجاح', 'success');
      await this.audit.log('حذف تصنيف مجلد', folder.name, `المجموعة: ${folder.group_name}`);
      await this.loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل حذف التصنيف';
      this.toast.show(message, 'error');
    }
  }

  isSystem(folder: Folder): boolean {
    return folder.is_system === 1;
  }

  isDeleteDisabled(folder: Folder): boolean {
    return this.isSystem(folder) || (folder.document_count ?? 0) > 0;
  }

  deleteTooltip(folder: Folder): string {
    if (this.isSystem(folder)) return 'لا يمكن حذف تصنيف نظامي';
    if ((folder.document_count ?? 0) > 0) return 'لا يمكن الحذف، يوجد وثائق مرتبطة';
    return 'حذف';
  }

  typeLabel(folder: Folder): string {
    return this.isSystem(folder) ? 'نظامي' : 'مخصص';
  }
}
