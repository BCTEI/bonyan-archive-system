import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-final-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './final-confirm-dialog.component.html',
  styleUrl: './final-confirm-dialog.component.scss'
})
export class FinalConfirmDialogComponent {
  private dialogRef = inject(MatDialogRef<FinalConfirmDialogComponent>);
  data = inject<{ title: string; message: string; warning: string; confirmText?: string }>(MAT_DIALOG_DATA);

  confirm(): void {
    this.dialogRef.close(true);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
