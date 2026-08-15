import { Injectable } from '@angular/core';

// Current format: the barcode payload is only the variable part of the ref
// number, e.g. "58/1" for "م.ب/58/1" (see generateDocumentBarcode in
// electron/database.ts) — plain ASCII, so no Arabic/RTL/Unicode scanner
// issues. Older printed labels that still encode the full reference (with
// the "م.ب/" prefix, or its legacy ASCII transliteration "MB/") are also
// accepted so they keep working.
const BARCODE_PATTERN = /^(?:م\.ب\/|MB\/)?\d+\/\d+$/;
// USB/keyboard-wedge scanners inject keystrokes far faster than a human can
// type; a gap larger than this between keydowns means it's not a scan and the
// buffer is discarded.
const MAX_KEY_GAP_MS = 60;
const MIN_LENGTH = 4;

/**
 * Detects a physical 1D barcode scanner acting as a keyboard-wedge device:
 * it "types" the barcode's characters in rapid succession followed by Enter.
 * Only listens while no form control has focus, so normal typing anywhere in
 * the app (search boxes, the document form, etc.) is never intercepted.
 */
@Injectable({
  providedIn: 'root'
})
export class BarcodeScanService {
  private buffer = '';
  private lastKeyTime = 0;
  private listening = false;
  private handler = (event: KeyboardEvent) => this.onKeyDown(event);

  start(onScan: (barcode: string) => void): () => void {
    if (!this.listening) {
      document.addEventListener('keydown', this.handler, true);
      this.listening = true;
    }
    this.onScan = onScan;
    return () => this.stop();
  }

  private onScan: (barcode: string) => void = () => {};

  private stop(): void {
    document.removeEventListener('keydown', this.handler, true);
    this.listening = false;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.isEditableTarget(target)) {
      this.buffer = '';
      return;
    }

    const now = Date.now();
    if (now - this.lastKeyTime > MAX_KEY_GAP_MS) {
      this.buffer = '';
    }
    this.lastKeyTime = now;

    if (event.key === 'Enter') {
      // Normalize (NFC) and strip bidi marks (U+200E/U+200F) some input
      // methods insert around RTL text, so a scan of Arabic content matches
      // the pattern reliably regardless of how the OS delivered the keys.
      const candidate = this.buffer.normalize('NFC').replace(/[‎‏]/g, '');
      this.buffer = '';
      if (candidate.length >= MIN_LENGTH && BARCODE_PATTERN.test(candidate)) {
        event.preventDefault();
        this.onScan(candidate);
      }
      return;
    }

    if (event.key.length === 1) {
      this.buffer += event.key;
    }
  }

  private isEditableTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }
}
