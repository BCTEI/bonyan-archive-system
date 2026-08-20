import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { NgClass } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [MatIconModule, MatButtonModule, NgClass],
  template: `
    <div class="fixed top-4 left-4 z-[9999] flex flex-col gap-2">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast-item flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white min-w-[280px] max-w-sm"
             [ngClass]="typeClass(toast.type)">
          <mat-icon>{{ typeIcon(toast.type) }}</mat-icon>
          <span class="flex-1 text-sm font-medium">{{ toast.message }}</span>
          <button mat-icon-button (click)="toastService.dismiss(toast.id)" class="!text-white !w-8 !h-8">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [``]
})
export class ToastComponent {
  toastService = inject(ToastService);

  typeClass(type: string): string {
    switch (type) {
      case 'success': return 'bg-success';
      case 'error': return 'bg-danger';
      case 'warning': return 'bg-warning';
      default: return 'bg-info';
    }
  }

  typeIcon(type: string): string {
    switch (type) {
      case 'success': return 'check_circle';
      case 'error': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  }
}
