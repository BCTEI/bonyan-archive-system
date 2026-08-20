import { Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-stats-card',
  standalone: true,
  imports: [MatCardModule, MatIconModule],
  template: `
    <mat-card class="stats-card" [style.border-right]="'4px solid ' + color()">
      <mat-card-content>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-text-light mb-1">{{ label() }}</p>
            <p class="text-3xl font-bold text-primary">{{ value() }}</p>
          </div>
          <mat-icon [style.color]="color()" class="!text-4xl !w-9 !h-9">{{ icon() }}</mat-icon>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [`
    .stats-card {
      background: var(--card);
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: transform 0.2s;
    }
    .stats-card:hover {
      transform: translateY(-2px);
    }
  `]
})
export class StatsCardComponent {
  label = input.required<string>();
  value = input.required<number>();
  icon = input.required<string>();
  color = input.required<string>();
}
