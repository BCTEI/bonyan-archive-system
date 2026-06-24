import { Injectable } from '@angular/core';
import { ArchivedYear } from '../models/annual-closing.model';

@Injectable({
  providedIn: 'root'
})
export class AnnualClosingService {
  private get api() {
    return window.electronAPI;
  }

  async getArchivedYears(): Promise<ArchivedYear[]> {
    const result = await this.api.annualClosingAPI.getArchivedYears();
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل السنوات المؤرشفة');
    return result.years ?? [];
  }

  async closeYear(year: number): Promise<{ message: string; backupPath?: string }> {
    const result = await this.api.annualClosingAPI.closeYear(year);
    if (!result.success) throw new Error(result.error ?? 'فشل إغلاق السنة');
    return { message: result.message!, backupPath: result.backupPath };
  }

  async getArchivedDocuments(year: number): Promise<unknown[]> {
    const result = await this.api.annualClosingAPI.getArchivedDocuments(year);
    if (!result.success) throw new Error(result.error ?? 'فشل تحميل الوثائق المؤرشفة');
    return result.documents ?? [];
  }
}
