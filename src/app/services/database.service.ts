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
    const result = await this.api.dbRun(sql, params);
    if (result && typeof result === 'object' && 'success' in result && result.success === false) {
      throw new Error((result as any).error ?? 'فشل تنفيذ العملية');
    }
    return result;
  }

  async getNextRef(typeId: number, folderId: number): Promise<string> {
    return this.api.getNextRef(typeId, folderId);
  }

  async getFolders(): Promise<Folder[]> {
    const result = await this.api.folderCategoryAPI.getAll();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل المجلدات');
    return result.folders ?? [];
  }

  async getDocuments(): Promise<ArchiveDocument[]> {
    const result = await this.api.documentAPI.getAll();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الوثائق');
    return result.documents ?? [];
  }

  async getDocumentById(id: number): Promise<ArchiveDocument | undefined> {
    const result = await this.api.documentAPI.getById(id);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الوثيقة');
    return result.document;
  }

  async getAuditEntries(limit?: number): Promise<AuditEntry[]> {
    try {
      const result = await this.api.auditAPI.list(limit);
      if (!result.success) return [];
      return result.entries ?? [];
    } catch {
      // Below section_head, audit:list is gated off — fail soft to an empty list
      // rather than breaking the dashboard's "recent audit" widget for lower roles.
      return [];
    }
  }

  async addAudit(action: string, docRef?: string, details?: string): Promise<boolean> {
    return this.api.addAudit(action, docRef, details);
  }

  async getStats(): Promise<{ total: number; [key: string]: number }> {
    const result = await this.api.getStats();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الإحصائيات');
    return result.stats ?? { total: 0 };
  }

  async exportData(): Promise<string> {
    const result = await this.api.exportData() as string | { success: false; error?: string };
    if (typeof result === 'object' && 'success' in result && result.success === false) {
      throw new Error(result.error ?? 'فشل التصدير');
    }
    return result as string;
  }

  async importData(jsonData: string, mode: 'merge' | 'replace'): Promise<{ success: boolean; message: string }> {
    const result = await this.api.importData(jsonData, mode);
    if (!result.success) throw new Error(result.message);
    return result;
  }
}
