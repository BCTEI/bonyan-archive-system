import { Injectable, signal } from '@angular/core';
import { toUserErrorMessage } from '../utils/error-message.util';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  toasts = signal<Toast[]>([]);
  private nextId = 1;

  show(message: string, type: Toast['type'] = 'info', duration = 4000): void {
    const toast: Toast = { id: this.nextId++, message, type };
    this.toasts.update(list => [...list, toast]);
    setTimeout(() => this.dismiss(toast.id), duration);
  }

  /** Collapses the repeated `catch (err) { ...; this.toast.show(message, 'error'); }` idiom, routing the message through toUserErrorMessage so raw backend text never reaches the UI. */
  showError(err: unknown, fallback: string): void {
    this.show(toUserErrorMessage(err, fallback), 'error');
  }

  dismiss(id: number): void {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }
}
