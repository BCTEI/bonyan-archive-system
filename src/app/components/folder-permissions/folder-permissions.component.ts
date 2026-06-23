import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { User, UserFolderPermission } from '../../models/user.model';
import { Folder } from '../../models/folder.model';
import { UserService } from '../../services/user.service';
import { DatabaseService } from '../../services/database.service';
import { ToastService } from '../../services/toast.service';

interface FolderGroup {
  name: string;
  expanded: boolean;
  folders: Folder[];
}

@Component({
  selector: 'app-folder-permissions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatCheckboxModule
  ],
  templateUrl: './folder-permissions.component.html',
  styleUrl: './folder-permissions.component.scss'
})
export class FolderPermissionsComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<FolderPermissionsComponent>);
  private data = inject<{ user: User }>(MAT_DIALOG_DATA);
  private userService = inject(UserService);
  private db = inject(DatabaseService);
  private toast = inject(ToastService);

  user = this.data.user;
  groups = signal<FolderGroup[]>([]);
  permissions = signal<Record<number, UserFolderPermission>>({});
  loading = signal(true);
  displayedColumns = ['name', 'can_view', 'can_create', 'can_edit', 'can_delete'];

  async ngOnInit(): Promise<void> {
    try {
      const [folders, saved] = await Promise.all([
        this.db.getFolders(),
        this.userService.getFolderPermissions(this.user.id!)
      ]);

      const permMap: Record<number, UserFolderPermission> = {};
      for (const f of folders) {
        permMap[f.id] = { folder_id: f.id, can_view: false, can_create: false, can_edit: false, can_delete: false };
      }
      for (const p of saved) {
        permMap[p.folder_id] = p;
      }
      this.permissions.set(permMap);

      const grouped = new Map<string, Folder[]>();
      for (const f of folders) {
        if (!grouped.has(f.group_name)) grouped.set(f.group_name, []);
        grouped.get(f.group_name)!.push(f);
      }
      this.groups.set([...grouped.entries()].map(([name, folders]) => ({ name, expanded: true, folders })));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ في تحميل البيانات';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  toggleGroup(group: FolderGroup): void {
    group.expanded = !group.expanded;
  }

  toggleColumn(action: 'can_view' | 'can_create' | 'can_edit' | 'can_delete', checked: boolean): void {
    this.permissions.update(map => {
      const next = { ...map };
      for (const id of Object.keys(next).map(Number)) {
        next[id] = { ...next[id], [action]: checked };
      }
      return next;
    });
  }

  selectAll(action: 'can_view' | 'can_create' | 'can_edit' | 'can_delete'): void {
    this.toggleColumn(action, true);
  }

  clearAll(): void {
    this.permissions.update(map => {
      const next: Record<number, UserFolderPermission> = {};
      for (const id of Object.keys(map).map(Number)) {
        next[id] = { folder_id: id, can_view: false, can_create: false, can_edit: false, can_delete: false };
      }
      return next;
    });
  }

  async save(): Promise<void> {
    try {
      const list = Object.values(this.permissions());
      await this.userService.setFolderPermissions(this.user.id!, list);
      this.toast.show('تم حفظ صلاحيات المجلدات', 'success');
      this.dialogRef.close(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      this.toast.show(message, 'error');
    }
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
