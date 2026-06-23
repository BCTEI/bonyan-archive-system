import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../services/auth.service';
import { FolderTreeComponent } from '../folder-tree/folder-tree.component';
import { ToastComponent } from '../toast/toast.component';

@Component({
  selector: 'app-app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    FolderTreeComponent,
    ToastComponent
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent {
  auth = inject(AuthService);
  router = inject(Router);
  sidebarOpen = signal(true);

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }

  onSearch(query: string): void {
    if (query.trim()) {
      this.router.navigate(['/main/documents'], { queryParams: { q: query.trim() } });
    } else {
      this.router.navigate(['/main/documents'], { queryParams: {} });
    }
  }
}
