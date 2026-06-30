import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-footer-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './footer-bar.component.html',
  styleUrl: './footer-bar.component.scss'
})
export class FooterBarComponent {
  currentYear = new Date().getFullYear();
}
