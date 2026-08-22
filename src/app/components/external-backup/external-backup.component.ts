import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BackupService } from '../../services/backup.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { PasswordConfirmDialogComponent } from '../dialogs/password-confirm-dialog/password-confirm-dialog.component';
import { BackupManifest } from '../../models/backup.model';

type Phase = 'idle' | 'running' | 'done';

@Component({
  selector: 'app-external-backup',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './external-backup.component.html',
  styleUrl: './external-backup.component.scss'
})
export class ExternalBackupComponent implements OnInit, OnDestroy {
  private backupService = inject(BackupService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private dialog = inject(MatDialog);
  private unsubscribeProgress: (() => void) | null = null;

  unlocked = signal(false);
  // Export state
  exportPath = signal('');
  exportPassword = signal('');
  exportPasswordConfirm = signal('');
  exportPhase = signal<Phase>('idle');
  exportPercent = signal(0);
  exportResult = signal<{ filePath: string; sizeBytes: number; sha256: string } | null>(null);
  // Restore state
  restoreFile = signal<{ filePath: string; manifest: BackupManifest } | null>(null);
  restorePassword = signal('');
  restoreAcknowledged = signal(false);
  restorePhase = signal<Phase>('idle');
  restorePercent = signal(0);
  restoreDone = signal(false);
  relaunchCountdown = signal(0);
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.unsubscribeProgress = this.backupService.onProgress(({ phase, percent }) => {
      if (phase === 'export') this.exportPercent.set(percent);
      else this.restorePercent.set(percent);
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeProgress?.();
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  async unlock(): Promise<void> {
    const username = this.auth.currentUser()?.username;
    if (!username) return;
    const ref = this.dialog.open(PasswordConfirmDialogComponent, {
      width: '420px', maxWidth: '95vw',
      data: { message: 'أدخل كلمة مرور حسابك للمتابعة — هذه العملية حساسة وتخص المدير العام فقط' }
    });
    const password: string | null = await new Promise(resolve => ref.afterClosed().subscribe(resolve));
    if (!password) return;
    const ok = await window.electronAPI.verifyPassword(username, password);
    if (!ok) {
      this.toast.show('كلمة المرور غير صحيحة', 'error');
      return;
    }
    this.unlocked.set(true);
  }

  async chooseDestination(): Promise<void> {
    try {
      const p = await this.backupService.chooseDestination();
      if (p) this.exportPath.set(p);
    } catch (err) { this.toast.showError(err, 'فشل اختيار مكان الحفظ'); }
  }

  exportReady(): boolean {
    return this.exportPhase() !== 'running' && !!this.exportPath()
      && this.exportPassword().length >= 10 && this.exportPassword() === this.exportPasswordConfirm();
  }

  async startExport(): Promise<void> {
    if (!this.exportReady()) return;
    this.exportPhase.set('running');
    this.exportPercent.set(0);
    this.exportResult.set(null);
    const passphrase = this.exportPassword();
    this.exportPassword.set('');
    this.exportPasswordConfirm.set('');
    try {
      const result = await this.backupService.export(this.exportPath(), passphrase);
      this.exportResult.set(result);
      this.exportPhase.set('done');
      this.toast.show('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } catch (err) {
      this.exportPhase.set('idle');
      this.toast.showError(err, 'فشل تصدير النسخة الاحتياطية');
    }
  }

  async chooseRestoreFile(): Promise<void> {
    try {
      const picked = await this.backupService.chooseBackupFile();
      if (picked) this.restoreFile.set(picked);
    } catch (err) { this.toast.showError(err, 'فشل قراءة النسخة الاحتياطية'); }
  }

  restoreReady(): boolean {
    return this.restorePhase() !== 'running' && !!this.restoreFile()
      && this.restorePassword().length >= 1 && this.restoreAcknowledged();
  }

  async startRestore(): Promise<void> {
    const file = this.restoreFile();
    if (!this.restoreReady() || !file) return;
    this.restorePhase.set('running');
    this.restorePercent.set(0);
    const passphrase = this.restorePassword();
    this.restorePassword.set('');
    try {
      await this.backupService.restore(file.filePath, passphrase);
      this.restorePhase.set('done');
      this.restoreDone.set(true);
      this.startRelaunchCountdown();
    } catch (err) {
      this.restorePhase.set('idle');
      this.toast.showError(err, 'فشلت الاستعادة');
    }
  }

  private startRelaunchCountdown(): void {
    this.relaunchCountdown.set(10);
    this.countdownTimer = setInterval(() => {
      const left = this.relaunchCountdown() - 1;
      this.relaunchCountdown.set(left);
      if (left <= 0) void this.relaunchNow();
    }, 1000);
  }

  async relaunchNow(): Promise<void> {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    await this.backupService.relaunchNow();
  }

  formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }
}
