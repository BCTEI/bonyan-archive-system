import { Component, inject, output, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService } from '../../services/auth.service';
import { ROLE_LABELS } from '../../models/user.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent {
  toggleSidebar = output<void>();

  private auth = inject(AuthService);
  private router = inject(Router);

  currentUser = this.auth.currentUser;
  displayName = computed(() => this.currentUser()?.full_name || this.currentUser()?.username || '');
  roleLabel = computed(() => this.currentUser() ? ROLE_LABELS[this.currentUser()!.role] : '');
  roleClass = computed(() => `role-${this.currentUser()?.role || 'viewer'}`);
  isDashboard = computed(() => this.router.url.includes('/dashboard'));
  isAdmin = computed(() => this.currentUser()?.role === 'admin');

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }

  onSearch(query: string): void {
    const trimmed = query.trim();
    if (trimmed) {
      this.router.navigate(['/main/documents'], { queryParams: { q: trimmed } });
    } else {
      this.router.navigate(['/main/documents'], { queryParams: {} });
    }
  }
}
