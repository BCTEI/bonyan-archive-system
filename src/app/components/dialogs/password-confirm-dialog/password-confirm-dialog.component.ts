import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-password-confirm-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './password-confirm-dialog.component.html',
  styleUrl: './password-confirm-dialog.component.scss'
})
export class PasswordConfirmDialogComponent {
  private dialogRef = inject(MatDialogRef<PasswordConfirmDialogComponent>);
  data = inject<{ message: string }>(MAT_DIALOG_DATA);

  password = '';
  error = '';

  confirm(): void {
    if (!this.password.trim()) {
      this.error = 'كلمة المرور مطلوبة';
      return;
    }
    this.dialogRef.close(this.password);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
