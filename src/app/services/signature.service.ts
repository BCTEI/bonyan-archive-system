import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SignatureService {
  getBlankCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  isEmpty(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return true;
    }
    const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    return !pixelBuffer.some(color => color !== 0);
  }

  toBase64(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL('image/png');
  }
}
