import { Injectable } from '@angular/core';
import { BackupManifest } from '../models/backup.model';
import { unwrap } from '../utils/ipc-result.util';

// Thin typed wrapper over the GM-only external-backup IPC surface
// (electron/main.ts backup:* channels). All methods throw Errors via unwrap;
// components display them through ToastService.showError.
@Injectable({ providedIn: 'root' })
export class BackupService {
  private get api() {
    return window.electronAPI;
  }

  /** Returns the chosen destination path, or null when the user cancels. */
  async chooseDestination(): Promise<string | null> {
    const result = unwrap(await this.api.backupAPI.chooseDestination(), 'فشل اختيار مكان الحفظ');
    return result.canceled ? null : (result.filePath ?? null);
  }

  async export(filePath: string, passphrase: string): Promise<{ filePath: string; sizeBytes: number; sha256: string }> {
    const result = unwrap(await this.api.backupAPI.export(filePath, passphrase), 'فشل تصدير النسخة الاحتياطية');
    return { filePath: result.filePath!, sizeBytes: result.sizeBytes!, sha256: result.sha256! };
  }

  /** Returns the chosen file + parsed manifest, or null when canceled. */
  async chooseBackupFile(): Promise<{ filePath: string; manifest: BackupManifest } | null> {
    const result = unwrap(await this.api.backupAPI.chooseBackupFile(), 'فشل قراءة النسخة الاحتياطية');
    if (result.canceled) return null;
    if (!result.filePath || !result.manifest) throw new Error('الملف المحدد ليس نسخة احتياطية صالحة من هذا النظام');
    return { filePath: result.filePath, manifest: result.manifest };
  }

  /** On success the live DB is already swapped — show the completion UI, then relaunchNow(). */
  async restore(filePath: string, passphrase: string): Promise<void> {
    unwrap(await this.api.backupAPI.restore(filePath, passphrase), 'فشلت الاستعادة');
  }

  async relaunchNow(): Promise<void> {
    await this.api.backupAPI.relaunchNow();
  }

  /** Subscribe to export/restore progress; returns an unsubscribe function. */
  onProgress(callback: (data: { phase: 'export' | 'restore'; percent: number }) => void): () => void {
    return this.api.onBackupProgress(callback);
  }
}
