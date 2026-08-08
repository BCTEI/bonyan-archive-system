import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DocumentCardComponent } from '../document-card/document-card.component';
import { DocumentViewComponent } from '../document-view/document-view.component';
import { AnnualClosingService } from '../../services/annual-closing.service';
import { FolderService } from '../../services/folder.service';
import { DocumentAccessService } from '../../services/document-access.service';
import { ToastService } from '../../services/toast.service';
import { ArchiveDocument, ConfidentialityLevel } from '../../models/document.model';
import { Folder } from '../../models/folder.model';

interface TypeOption {
  id: number;
  label: string;
  icon?: string;
  color?: string;
}

@Component({
  selector: 'app-archive-browser',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DocumentCardComponent
  ],
  templateUrl: './archive-browser.component.html',
  styleUrl: './archive-browser.component.scss'
})
export class ArchiveBrowserComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private annualClosingService = inject(AnnualClosingService);
  private folderService = inject(FolderService);
  private documentAccess = inject(DocumentAccessService);
  private toast = inject(ToastService);

  year = signal(0);
  documents = signal<ArchiveDocument[]>([]);
  folders = signal<Folder[]>([]);
  filtered = signal<ArchiveDocument[]>([]);
  loading = signal(false);

  search = signal('');
  selectedTypeId = signal<number | 'الكل'>('الكل');
  selectedConfidentiality = signal<ConfidentialityLevel | 'الكل'>('الكل');

  confidentialityLevels: { value: ConfidentialityLevel | 'الكل'; label: string }[] = [
    { value: 'الكل', label: 'الكل' },
    { value: 'عادي', label: '🟢 عادي' },
    { value: 'سري', label: '🟡 سري' },
    { value: 'سري للغاية', label: '🔴 سري للغاية' }
  ];

  // Type filter options are derived from the archived documents themselves
  // (not the live document_types table) — a type could have been renamed,
  // recolored, or deactivated since the year was closed, and the archive
  // must keep showing it as it was at archive time.
  typeOptions = computed<TypeOption[]>(() => {
    const seen = new Map<number, TypeOption>();
    for (const d of this.documents()) {
      if (!seen.has(d.type_id)) {
        seen.set(d.type_id, { id: d.type_id, label: d.type_label ?? d.type ?? String(d.type_id), icon: d.type_icon, color: d.type_color });
      }
    }
    return Array.from(seen.values());
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const year = Number(params.get('year'));
      if (!Number.isInteger(year)) {
        this.toast.show('سنة غير صالحة', 'error');
        this.router.navigate(['/main/annual-closing']);
        return;
      }
      this.year.set(year);
      void this.loadData();
    });
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [docs, folders] = await Promise.all([
        this.annualClosingService.getArchivedDocuments(this.year()),
        this.folderService.getAll()
      ]);
      this.documents.set(docs);
      this.folders.set(folders);
      this.selectedTypeId.set('الكل');
      this.selectedConfidentiality.set('الكل');
      this.search.set('');
      this.applyFilters();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحميل الوثائق المؤرشفة';
      this.toast.show(message, 'error');
    } finally {
      this.loading.set(false);
    }
  }

  applyFilters(): void {
    let list = this.documents();
    const typeId = this.selectedTypeId();
    const conf = this.selectedConfidentiality();
    const term = this.search().trim();

    if (typeId !== 'الكل') {
      list = list.filter(d => d.type_id === typeId);
    }
    if (conf !== 'الكل') {
      list = list.filter(d => d.confidentiality === conf);
    }
    if (term) {
      list = list.filter(d =>
        d.subject.includes(term) ||
        d.ref_number.includes(term) ||
        (d.sender?.includes(term) ?? false) ||
        (d.receiver?.includes(term) ?? false)
      );
    }
    this.filtered.set(list);
  }

  setType(typeId: number | 'الكل'): void {
    this.selectedTypeId.set(typeId);
    this.applyFilters();
  }

  setConfidentiality(level: ConfidentialityLevel | 'الكل'): void {
    this.selectedConfidentiality.set(level);
    this.applyFilters();
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.applyFilters();
  }

  folderName(folderId: number): string {
    return this.folders().find(f => f.id === folderId)?.name ?? '';
  }

  goBack(): void {
    this.router.navigate(['/main/annual-closing']);
  }

  /**
   * Fetches the full row for `doc` and opens it in DocumentViewComponent.
   * Archive list rows never carry body/attachments/signature (see
   * AnnualClosingService.getArchivedDocuments), so a fetch-by-id is required
   * for EVERY confidentiality level, not just top-secret — verifyAccess alone
   * only gates/refreshes top-secret rows.
   *
   * scope is `archive:<year>` so DocumentAccessService.refreshTopSecretDoc
   * re-fetches top-secret content from this year's archive table instead of
   * the live `documents` table (see document-access.service.ts design note).
   */
  private async openArchivedDoc(doc: ArchiveDocument, print: boolean): Promise<void> {
    const scope = `archive:${this.year()}`;
    const action = print ? 'print' : 'view';
    const verified = await this.documentAccess.verifyAccess(doc, action, scope);
    if (!verified) return;

    if (doc.id === undefined) return;
    const full = await this.annualClosingService.getArchivedDocumentById(this.year(), doc.id).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'فشل تحميل الوثيقة المؤرشفة';
      this.toast.show(message, 'error');
      return undefined;
    });
    if (!full) return;

    this.dialog.open(DocumentViewComponent, {
      width: '850px',
      maxWidth: '95vw',
      data: { doc: full, folder: this.folders().find(f => f.id === full.folder_id), scope, print }
    });
  }

  async onView(doc: ArchiveDocument): Promise<void> {
    await this.openArchivedDoc(doc, false);
  }

  async onPrint(doc: ArchiveDocument): Promise<void> {
    await this.openArchivedDoc(doc, true);
  }
}
