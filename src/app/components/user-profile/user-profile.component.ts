import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { ROLE_LABELS } from '../../models/user.model';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.scss'
})
export class UserProfileComponent {
  auth = inject(AuthService);
  roleLabels = ROLE_LABELS;

  formatDate(ts?: number | string | null): string {
    if (ts === null || ts === undefined || ts === '') return '-';
    const num = typeof ts === 'number' ? ts : Number(ts);
    if (!isFinite(num)) return '-';
    return new Date(num * 1000).toLocaleDateString('ar-LY');
  }
}
