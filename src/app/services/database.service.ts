import { Injectable } from '@angular/core';
import { ArchiveDocument } from '../models/document.model';
import { Folder } from '../models/folder.model';
import { AuditEntry } from '../models/audit-entry.model';

@Injectable({
  providedIn: 'root'
})
export class DatabaseService {
  private get api() {
    return window.electronAPI;
  }

  async init(): Promise<boolean> {
    return this.api.dbInit();
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.api.dbQuery(sql, params);
    return result as T[];
  }

  async run(sql: string, params?: unknown[]): Promise<{ lastInsertRowid: number | bigint; changes: number }> {
    return this.api.dbRun(sql, params);
  }

  async getNextRef(type: 'صادر' | 'وارد' | 'مراسلات', folderId: number): Promise<string> {
    return this.api.getNextRef(type, folderId);
  }

  async getFolders(): Promise<Folder[]> {
    return this.query<Folder>('SELECT * FROM folders ORDER BY id');
  }

  async getDocuments(): Promise<ArchiveDocument[]> {
    return this.query<ArchiveDocument>('SELECT * FROM documents ORDER BY created_at DESC');
  }

  async getDocumentById(id: number): Promise<ArchiveDocument | undefined> {
    const rows = await this.query<ArchiveDocument>('SELECT * FROM documents WHERE id = ?', [id]);
    return rows[0];
  }

  async getAuditEntries(limit?: number): Promise<AuditEntry[]> {
    const sql = limit
      ? 'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM audit_log ORDER BY timestamp DESC';
    return this.query<AuditEntry>(sql, limit ? [limit] : undefined);
  }

  async addAudit(action: string, docRef?: string, details?: string): Promise<boolean> {
    return this.api.addAudit(action, docRef, details);
  }

  async getStats(): Promise<{ total: number; صادر: number; وارد: number; مراسلات: number }> {
    const result = await this.api.dbQuery('SELECT type, COUNT(*) as c FROM documents GROUP BY type');
    const stats = { total: 0, صادر: 0, وارد: 0, مراسلات: 0 };
    for (const row of result as Array<{ type: string; c: number }>) {
      if (row.type in stats) {
        (stats as Record<string, number>)[row.type] = row.c;
      }
      stats.total += row.c;
    }
    return stats;
  }

  async exportData(): Promise<string> {
    return this.api.exportData();
  }

  async importData(jsonData: string, mode: 'merge' | 'replace'): Promise<{ success: boolean; message: string }> {
    return this.api.importData(jsonData, mode);
  }
}
