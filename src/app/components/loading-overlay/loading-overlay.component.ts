import { Component, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  template: `
    @if (showing()) {
      <div class="fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center backdrop-blur-sm">
        <mat-spinner diameter="56" color="accent"></mat-spinner>
      </div>
    }
  `,
  styles: [``]
})
export class LoadingOverlayComponent {
  showing = input.required<boolean>();
}
