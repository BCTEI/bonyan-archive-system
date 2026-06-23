import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { ArchiveDocument } from '../../models/document.model';
import { AuthService } from '../../services/auth.service';
import { DocumentService } from '../../services/document.service';
import { HasPermissionDirective } from '../../directives/has-permission.directive';

@Component({
  selector: 'app-document-card',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatButtonModule, MatMenuModule, HasPermissionDirective],
  templateUrl: './document-card.component.html',
  styleUrl: './document-card.component.scss'
})
export class DocumentCardComponent {
  doc = input.required<ArchiveDocument>();
  folderName = input<string>('');
  highlight = input('');

  view = output<ArchiveDocument>();
  edit = output<ArchiveDocument>();
  delete = output<ArchiveDocument>();
  print = output<ArchiveDocument>();

  auth = inject(AuthService);
  documentService = inject(DocumentService);

  attachmentsCount(): number {
    return this.documentService.parseAttachments(this.doc()).length;
  }

  typeClass(type: string): string {
    switch (type) {
      case 'صادر': return 'bg-success/10 text-success';
      case 'وارد': return 'bg-warning/10 text-warning';
      default: return 'bg-info/10 text-info';
    }
  }

  highlighted(text: string): string {
    const term = this.highlight().trim();
    if (!term || !text) return text;
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${safe})`, 'gi');
    return text.replace(re, '<mark class="bg-yellow-200 px-0.5 rounded">$1</mark>');
  }
}
