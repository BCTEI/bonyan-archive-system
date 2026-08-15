import { Injectable } from '@angular/core';
import { buildCode128Fnc4Modules } from './code128-fnc4';

// Document ref numbers are Arabic (e.g. "م.ب/58/1"), and plain Code128 can only
// hold ASCII bytes 0-127 — every byte of Arabic UTF-8 text is >= 128. Rather than
// transliterating the Arabic away (which is what the old JsBarcode-based version
// of this file did, producing a barcode that only ever decoded to "MB/58/1"), the
// barcode is built by hand using Code128's FNC4 "Full ASCII" byte mode, which packs
// the literal UTF-8 bytes of the reference number into the symbol. See
// code128-fnc4.ts for the full rationale and encoding details.
const NS = 'http://www.w3.org/2000/svg';

export interface BarcodeRenderOptions {
  height?: number;
  width?: number;
  margin?: number;
  background?: string;
  lineColor?: string;
}

const BARCODE_OPTIONS: Required<BarcodeRenderOptions> = {
  height: 60,
  width: 2,
  margin: 8,
  background: '#ffffff',
  lineColor: '#000000'
};

@Injectable({
  providedIn: 'root'
})
export class BarcodeService {
  private buildSvg(value: string, options?: BarcodeRenderOptions): SVGSVGElement {
    const { height, width, margin, background, lineColor } = { ...BARCODE_OPTIONS, ...options };
    const modules = buildCode128Fnc4Modules(value);
    const totalWidth = modules.length * width + margin * 2;

    const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(totalWidth));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${totalWidth} ${height}`);

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(totalWidth));
    bg.setAttribute('height', String(height));
    bg.setAttribute('fill', background);
    svg.appendChild(bg);

    let x = margin;
    for (const moduleChar of modules) {
      if (moduleChar === '1') {
        const bar = document.createElementNS(NS, 'rect');
        bar.setAttribute('x', String(x));
        bar.setAttribute('y', '0');
        bar.setAttribute('width', String(width));
        bar.setAttribute('height', String(height));
        bar.setAttribute('fill', lineColor);
        svg.appendChild(bar);
      }
      x += width;
    }

    return svg;
  }

  /** Renders a barcode directly onto a live SVG element already in the DOM (e.g. via ViewChild). */
  renderToElement(svg: SVGSVGElement, value: string, options?: BarcodeRenderOptions): void {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const built = this.buildSvg(value, options);
    svg.setAttribute('width', built.getAttribute('width')!);
    svg.setAttribute('height', built.getAttribute('height')!);
    svg.setAttribute('viewBox', built.getAttribute('viewBox')!);
    while (built.firstChild) svg.appendChild(built.firstChild);
  }

  /** Builds standalone `<svg>…</svg>` markup for embedding in a print window's HTML string. */
  toSvgMarkup(value: string, options?: BarcodeRenderOptions): string {
    return new XMLSerializer().serializeToString(this.buildSvg(value, options));
  }
}
