import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { FolderService } from '../../services/folder.service';
import { Folder } from '../../models/folder.model';

@Component({
  selector: 'app-folder-tree',
  standalone: true,
  imports: [CommonModule, FormsModule, MatExpansionModule, MatIconModule],
  templateUrl: './folder-tree.component.html',
  styleUrl: './folder-tree.component.scss'
})
export class FolderTreeComponent implements OnInit {
  folderService = inject(FolderService);
  router = inject(Router);
  folders = signal<Folder[]>([]);
  grouped = signal<Map<string, Folder[]>>(new Map());
  filter = signal('');
  selectedFolderId = signal<number | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadFolders();
  }

  async loadFolders(): Promise<void> {
    const list = await this.folderService.getAllWithCounts();
    this.folders.set(list);
    this.grouped.set(this.folderService.groupByGroupName(list));
  }

  filteredFolders(folders: Folder[]): Folder[] {
    const term = this.filter().trim();
    if (!term) return folders;
    return folders.filter(f => f.name.includes(term));
  }

  selectFolder(folder: Folder): void {
    this.selectedFolderId.set(folder.id);
    this.router.navigate(['/main/documents'], { queryParams: { folder: folder.id } });
  }

  groupKeys(): string[] {
    return Array.from(this.grouped().keys());
  }
}
