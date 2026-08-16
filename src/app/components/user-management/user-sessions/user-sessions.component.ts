import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UserSession } from '../../../models/user.model';
import { UserService } from '../../../services/user.service';
import { ToastService } from '../../../services/toast.service';
import { formatDateTime } from '../../../utils/format-date.util';

@Component({
  selector: 'app-user-sessions',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule
  ],
  providers: [DatePipe],
  templateUrl: './user-sessions.component.html',
  styleUrl: './user-sessions.component.scss'
})
export class UserSessionsComponent implements OnInit {
  data = inject<{ userId: number; username: string }>(MAT_DIALOG_DATA);
  private userService = inject(UserService);
  private toast = inject(ToastService);

  sessions = signal<UserSession[]>([]);
  loading = signal(true);
  displayedColumns = ['action', 'timestamp', 'device_info'];

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.userService.getSessions(this.data.userId);
      this.sessions.set(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'خطأ في تحميل السجل';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  formatDate = formatDateTime;
}
