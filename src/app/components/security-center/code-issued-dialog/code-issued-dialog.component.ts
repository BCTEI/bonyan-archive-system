import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ToastService } from '../../../services/toast.service';

export interface CodeIssuedDialogData {
  username: string;
  code: string;
  /** Unix seconds (as returned by securityAPI.generateCode), not milliseconds. */
  expiresAt: number;
}

// Shows a freshly generated per-user verification code exactly once — the plain
// code is never persisted or re-displayed after this dialog closes (the issued
// codes table only ever shows metadata, never the code itself).
@Component({
  selector: 'app-code-issued-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './code-issued-dialog.component.html',
  styleUrl: './code-issued-dialog.component.scss'
})
export class CodeIssuedDialogComponent {
  private dialogRef = inject(MatDialogRef<CodeIssuedDialogComponent>);
  private toast = inject(ToastService);
  data = inject<CodeIssuedDialogData>(MAT_DIALOG_DATA);

  expiryLabel = new Date(this.data.expiresAt * 1000).toLocaleString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.data.code);
      this.toast.show('تم نسخ الرمز', 'success');
    } catch {
      this.toast.show('فشل نسخ الرمز', 'error');
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
