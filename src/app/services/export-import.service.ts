import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';

@Injectable({
  providedIn: 'root'
})
export class ExportImportService {
  constructor(private db: DatabaseService) {}

  async exportToFile(filename = 'bonyan-archive-backup.json'): Promise<void> {
    const data = await this.db.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async importFromJson(jsonData: string, mode: 'merge' | 'replace'): Promise<{ success: boolean; message: string }> {
    return this.db.importData(jsonData, mode);
  }
}
