import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MasterListService } from '../../services/master-list.service';
import { ToastService } from '../../services/toast.service';
import { MasterListEntry, MasterListType } from '../../models/master-list.model';
import { MasterListFormComponent } from './master-list-form/master-list-form.component';

@Component({
  selector: 'app-master-list-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './master-list-management.component.html',
  styleUrl: './master-list-management.component.scss'
})
export class MasterListManagementComponent implements OnInit {
  private masterListService = inject(MasterListService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);

  activeTab = signal<MasterListType>('author');
  items = signal<MasterListEntry[]>([]);
  search = signal('');
  loading = signal(false);

  tabs: { value: MasterListType; label: string; icon: string }[] = [
    { value: 'author', label: '✍️ المؤلفين', icon: 'edit' },
    { value: 'sender', label: '📤 الجهات المرسلة', icon: 'send' },
    { value: 'receiver', label: '📥 الجهات المستقبلة', icon: 'mark_email_read' },
    { value: 'department', label: '🏢 الأقسام', icon: 'account_balance' }
  ];

  async ngOnInit(): Promise<void> {
    await this.loadItems();
  }

  async loadItems(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.masterListService.getAll(this.activeTab(), false);
      this.items.set(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل القائمة';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  filteredItems(): MasterListEntry[] {
    const term = this.search().trim();
    if (!term) return this.items();
    return this.items().filter(i => i.name.toLowerCase().includes(term.toLowerCase()));
  }

  setTab(type: MasterListType): void {
    this.activeTab.set(type);
    this.search.set('');
    void this.loadItems();
  }

  openAdd(): void {
    const ref = this.dialog.open(MasterListFormComponent, {
      width: '450px',
      maxWidth: '95vw',
      data: { listType: this.activeTab() }
    });
    ref.afterClosed().subscribe(async result => {
      if (result) {
        await this.loadItems();
        this.toast.show('تم إضافة العنصر بنجاح', 'success');
      }
    });
  }

  openEdit(item: MasterListEntry): void {
    const ref = this.dialog.open(MasterListFormComponent, {
      width: '450px',
      maxWidth: '95vw',
      data: { item }
    });
    ref.afterClosed().subscribe(async result => {
      if (result) {
        await this.loadItems();
        this.toast.show('تم تحديث العنصر بنجاح', 'success');
      }
    });
  }

  async toggleStatus(item: MasterListEntry): Promise<void> {
    try {
      const next = item.is_active === 1 ? 0 : 1;
      await this.masterListService.toggleStatus(item.id, next);
      await this.loadItems();
      this.toast.show(next === 1 ? 'تم تفعيل العنصر' : 'تم تعطيل العنصر', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تغيير الحالة';
      this.toast.show(message, 'error');
    }
  }

  async deleteItem(item: MasterListEntry): Promise<void> {
    if (!confirm(`هل أنت متأكد من حذف "${item.name}"؟`)) return;
    try {
      await this.masterListService.delete(item.id);
      await this.loadItems();
      this.toast.show('تم حذف العنصر', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل الحذف';
      this.toast.show(message, 'error');
    }
  }
}
