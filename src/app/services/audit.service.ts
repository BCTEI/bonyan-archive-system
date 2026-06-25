import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { AuditEntry } from '../models/audit-entry.model';

@Injectable({
  providedIn: 'root'
})
export class AuditService {
  constructor(private db: DatabaseService) {}

  private get api() {
    return window.electronAPI;
  }

  async getEntries(limit?: number): Promise<AuditEntry[]> {
    return this.db.getAuditEntries(limit);
  }

  async log(action: string, docRef?: string, details?: string): Promise<void> {
    await this.db.addAudit(action, docRef, details);
  }

  async clearAll(): Promise<{ success: boolean; error?: string }> {
    return this.api.auditAPI.clearAll();
  }
}
