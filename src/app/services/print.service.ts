import { Injectable, inject } from '@angular/core';
import { ArchiveDocument, Attachment } from '../models/document.model';
import { Folder } from '../models/folder.model';
import { User } from '../models/user.model';
import { BarcodeService } from './barcode.service';
import { convertDocxToHtml } from '../utils/docx-preview.util';

interface FileChip {
  label: string;
  bg: string;
  fg: string;
}

type AttachmentKind = 'image' | 'pdf' | 'docx' | 'unsupported';

@Injectable({
  providedIn: 'root'
})
export class PrintService {
  private barcodeService = inject(BarcodeService);
  private logoDataUri: Promise<string | null> | null = null;

  async printDocument(doc: ArchiveDocument, folder: Folder | undefined, user: User | null): Promise<void> {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('تم حظر نافذة الطباعة، يرجى السماح بالنوافذ المنبثقة');
      return;
    }

    const [logo, docxHtmlByIndex] = await Promise.all([
      this.getLogoDataUri(),
      this.resolveDocxAttachments(doc)
    ]);
    printWindow.document.write(this.generatePrintHTML(doc, folder, user, logo, docxHtmlByIndex));
    printWindow.document.close();

    // Wait for images to load then print
    setTimeout(() => {
      printWindow.print();
    }, 600);
  }

  /** Small-format printout of just the barcode + ref number, sized for archive labels. */
  printBarcodeLabel(doc: ArchiveDocument) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('تم حظر نافذة الطباعة، يرجى السماح بالنوافذ المنبثقة');
      return;
    }

    printWindow.document.write(this.generateLabelHTML(doc));
    printWindow.document.close();

    setTimeout(() => {
      printWindow.print();
    }, 400);
  }

  /** Fetches the app logo once and caches it as a data URI so print windows (separate document contexts) can render it reliably. */
  private getLogoDataUri(): Promise<string | null> {
    if (!this.logoDataUri) {
      this.logoDataUri = fetch('assets/images/bonyan-logo-full.png')
        .then(res => (res.ok ? res.blob() : Promise.reject(new Error('logo not found'))))
        .then(blob => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }))
        .catch(() => null);
    }
    return this.logoDataUri;
  }

  private generateLabelHTML(doc: ArchiveDocument): string {
    const barcodeSvg = doc.barcode
      ? this.barcodeService.toSvgMarkup(doc.barcode, { height: 45, width: 1.8, margin: 4 })
      : '';

    return `
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>ملصق باركود - ${this.escapeHtml(doc.ref_number)}</title>
        <style>
          @page { size: 80mm 50mm; margin: 3mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Tajawal', Arial, sans-serif; }
          .label {
            width: 73mm; min-height: 43mm; height: auto;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 4px; border: 1px dashed #94a3b8; border-radius: 4px; padding: 4px;
          }
          .ref { font-family: monospace; font-size: 14pt; font-weight: 700; }
          .folder { font-size: 9pt; color: #475569; }
          svg { max-width: 100%; }
          @media print { .label { border: none; } }
        </style>
      </head>
      <body>
        <div class="label">
          <div class="ref">${this.escapeHtml(doc.ref_number)}</div>
          ${barcodeSvg}
        </div>
      </body>
      </html>
    `;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private inputMethodLabel(method: string): string {
    switch (method) {
      case 'upload': return 'تحميل من الجهاز';
      case 'camera': return 'التقاط صورة';
      case 'scanner': return 'الماسح الضوئي';
      default: return method;
    }
  }

  private statusClass(status: string): string {
    switch (status) {
      case 'معتمد': return 'status-approved';
      case 'قيد الاعتماد': return 'status-pending';
      case 'مرفوض': return 'status-rejected';
      case 'موقوف': return 'status-rejected';
      default: return 'status-default';
    }
  }

  private fileChip(ext: string): FileChip {
    switch (ext.toLowerCase()) {
      case 'pdf': return { label: 'PDF', bg: '#fbe4e0', fg: '#9a3412' };
      case 'doc': case 'docx': return { label: 'DOC', bg: '#dbe6f6', fg: '#1e3a5f' };
      case 'xls': case 'xlsx': return { label: 'XLS', bg: '#dcf0e1', fg: '#166534' };
      case 'csv': return { label: 'CSV', bg: '#fff3d6', fg: '#92600a' };
      case 'jpg': case 'jpeg': case 'png': case 'webp': return { label: 'IMG', bg: '#ece1f7', fg: '#6b21a8' };
      default: return { label: ext.slice(0, 3).toUpperCase() || 'FILE', bg: '#eceef2', fg: '#5b6472' };
    }
  }

  private attachmentKind(ext: string, hasDocxHtml: boolean): AttachmentKind {
    const e = ext.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(e)) return 'image';
    if (e === 'pdf') return 'pdf';
    if (e === 'docx' && hasDocxHtml) return 'docx';
    return 'unsupported';
  }

  private imageMime(ext: string): string {
    if (ext.toLowerCase() === 'png') return 'image/png';
    if (ext.toLowerCase() === 'webp') return 'image/webp';
    return 'image/jpeg';
  }

  /** Converts every .docx attachment to HTML up front (mammoth is async) so the
   *  synchronous generatePrintHTML/buildAttachmentSheet pass below can just look
   *  the result up by index. A conversion failure for one attachment leaves that
   *  index unset — buildAttachmentSheet then falls back to the placeholder. */
  private async resolveDocxAttachments(doc: ArchiveDocument): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    let attachments: Attachment[] = [];
    try {
      const parsed = JSON.parse(doc.attachments_json);
      if (Array.isArray(parsed)) attachments = parsed;
    } catch {
      return result;
    }

    await Promise.all(attachments.map(async (att, index) => {
      if ((att.ext || '').toLowerCase() !== 'docx' || !att.base64) return;
      try {
        result.set(index, await convertDocxToHtml(att.base64));
      } catch (err) {
        console.error('[PrintService] DOCX conversion failed for print:', att.name, err);
      }
    }));
    return result;
  }

  private formatPrintTimestamp(): string {
    try {
      return new Date().toLocaleString('ar-LY', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date().toLocaleString();
    }
  }

  /** Renders one label/value pair as a two-cell table row segment; falls back to an em dash for empty values. */
  private dataCell(label: string, value: string, extraClass = ''): string {
    return `
      <td class="dt-label">${label}</td>
      <td class="dt-value ${extraClass}">${value ? this.escapeHtml(value) : '—'}</td>`;
  }

  private buildBarcodeFooter(doc: ArchiveDocument, printedAt: string, printedBy: string): string {
    const barcodeSvg = doc.barcode
      ? this.barcodeService.toSvgMarkup(doc.barcode, { height: 42, width: 1.4, margin: 0 })
      : '';
    return `
      <div class="sheet-footer">
        <div class="footer-meta">
          <div><strong>مركز البنيان لتقنية والصناعات الهندسية</strong> — نظام الأرشيف الإلكتروني</div>
          <div>طُبع بتاريخ ${printedAt}${printedBy ? ' — بواسطة ' + printedBy : ''}</div>
        </div>
        <div class="footer-barcode">
          ${barcodeSvg}
          <span>${this.escapeHtml(doc.ref_number)}</span>
        </div>
      </div>`;
  }

  private buildAttachmentRow(att: Attachment, docxHtml?: string): string {
    const ext = (att.ext || '').toLowerCase();
    const chip = this.fileChip(ext);
    const kind = this.attachmentKind(ext, !!docxHtml);
    const note = kind === 'unsupported'
      ? 'غير قابل للمعاينة عند الطباعة — يُرجى فتح المرفق يدويًا'
      : kind === 'pdf'
        ? 'ملف PDF — يُطبع من عارض المرفقات'
        : 'يُطبع في الصفحة التالية';
    return `
      <div class="att-row">
        <span class="att-chip" style="background:${chip.bg};color:${chip.fg}">${chip.label}</span>
        <span class="att-name">${this.escapeHtml(att.name)}.${this.escapeHtml(ext)}</span>
        <span class="att-note">${note}</span>
      </div>`;
  }

  /** One printed A4 sheet per attachment, showing the actual file content (or a placeholder when it can't be previewed). */
  private buildAttachmentSheet(att: Attachment, index: number, total: number, doc: ArchiveDocument, printedAt: string, printedBy: string, docxHtml?: string): string {
    const ext = (att.ext || '').toLowerCase();
    const kind = this.attachmentKind(ext, !!docxHtml);
    let frameContent: string;

    if (kind === 'image' && att.base64) {
      frameContent = `<img src="data:${this.imageMime(ext)};base64,${att.base64}" alt="${this.escapeHtml(att.name)}">`;
    } else if (kind === 'pdf') {
      // <embed> with a base64 PDF does not paint into the print raster — the
      // sheet would come out blank, so show the same styled placeholder used
      // for unsupported types instead.
      frameContent = `
        <div class="p2-placeholder">
          <div class="icon">📄</div>
          <p>ملف PDF — يُطبع من عارض المرفقات داخل النظام.</p>
        </div>`;
    } else if (kind === 'docx' && docxHtml) {
      // docxHtml is DOMPurify-sanitized inside convertDocxToHtml — the bytes
      // come from a user-uploaded attachment, so never bypass that step.
      frameContent = `<div class="docx-print-content">${docxHtml}</div>`;
    } else if (!att.base64) {
      frameContent = `
        <div class="p2-placeholder">
          <div class="icon">⚠</div>
          <p>تعذر تحميل هذا المرفق للمعاينة والطباعة.</p>
        </div>`;
    } else {
      frameContent = `
        <div class="p2-placeholder">
          <div class="icon">📄</div>
          <p>هذا النوع من الملفات (${this.escapeHtml(ext.toUpperCase())}) لا يمكن معاينته أو طباعته مباشرة ضمن هذه الصفحة. يُرجى فتح المرفق من داخل النظام لطباعته بشكل منفصل.</p>
        </div>`;
    }

    const hasContent = kind === 'image' || kind === 'docx';

    return `
      <div class="sheet">
        <div class="p2-header">
          <div>
            <div class="p2-file-name">${this.escapeHtml(att.name)}.${this.escapeHtml(ext)}</div>
            <div class="p2-file-sub">مرفق ${index + 1} من ${total}</div>
          </div>
          <div class="p2-follow-badge">تابع للرقم الإشاري: ${this.escapeHtml(doc.ref_number)}</div>
        </div>
        <div class="p2-frame ${hasContent ? 'has-content' : ''} ${kind === 'docx' ? 'docx-frame' : ''}">
          ${frameContent}
        </div>
        ${this.buildBarcodeFooter(doc, printedAt, printedBy)}
      </div>`;
  }

  private generatePrintHTML(doc: ArchiveDocument, folder: Folder | undefined, user: User | null, logoDataUri: string | null, docxHtmlByIndex: Map<number, string>): string {
    const attachments: Attachment[] = [];
    try {
      const parsed = JSON.parse(doc.attachments_json);
      if (Array.isArray(parsed)) attachments.push(...parsed);
    } catch {
      // ignore
    }

    const typeLabel = `${doc.type_icon ?? ''} ${doc.type_label ?? doc.type ?? '—'}`.trim();
    // The signature is stored as a base64 data URI from the canvas, but it
    // round-trips through the DB — only render it if it still looks like one,
    // so a tampered value can't break out of the <img src> attribute.
    const signatureSrc = doc.signature_base64 && /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/.test(doc.signature_base64)
      ? doc.signature_base64
      : null;
    const logoBlock = logoDataUri
      ? `<img src="${logoDataUri}" alt="شعار مركز البنيان">`
      : `<span class="seal-initials">م.ب</span>`;
    const classification = folder ? `${folder.id} — ${folder.name}` : '—';
    const printedAt = this.formatPrintTimestamp();
    const printedBy = this.escapeHtml(user?.full_name || user?.username || '');

    const contentParts: { label: string; value: string }[] = [];
    if (doc.address) contentParts.push({ label: 'العنوان / الوصف', value: doc.address });
    if (doc.content) contentParts.push({ label: 'المحتوى / الملخص', value: doc.content });
    if (doc.body) contentParts.push({ label: 'المضمون', value: doc.body });

    const contentBody = contentParts.length
      ? contentParts.map(p => `
        <div class="text-block">
          <span class="field-label">${p.label}</span>
          <p>${this.escapeHtml(p.value)}</p>
        </div>`).join('')
      : `<p class="empty-note">لا يوجد محتوى إضافي مسجل لهذه الوثيقة.</p>`;

    const attachmentSheets = attachments
      .map((att, i) => this.buildAttachmentSheet(att, i, attachments.length, doc, printedAt, printedBy, docxHtmlByIndex.get(i)))
      .join('');

    return `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>${this.escapeHtml(doc.ref_number)} — ${this.escapeHtml(doc.subject)}</title>
        <style>
          :root {
            --navy-deep: #152c49;
            --navy: #1e3a5f;
            --navy-mid: #274a82;
            --gold: #a9862f;
            --gold-soft: #d9c284;
            --paper: #fbfaf7;
            --ink: #1c2430;
            --ink-soft: #5b6472;
            --line: #d7dbe3;
            --line-soft: #eceef2;
            --stripe: #f4f5f8;
          }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { background: #e7e9ee; }
          body {
            direction: rtl;
            font-family: 'Tajawal', 'Segoe UI', Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.65;
            color: var(--ink);
            padding: 20px 0 40px;
          }

          @page { size: A4; margin: 0; }

          .sheet {
            width: 210mm;
            min-height: 296mm;
            box-sizing: border-box;
            padding: 16mm 15mm 14mm;
            background: var(--paper);
            display: flex;
            flex-direction: column;
            margin: 0 auto 20px;
            box-shadow: 0 8px 30px rgba(15, 33, 64, 0.18);
          }

          /* ---- letterhead ---- */
          .letterhead {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding-bottom: 14px;
            border-bottom: 2px solid var(--navy);
          }
          .seal {
            flex: 0 0 auto;
            width: 70px;
            height: 70px;
            border-radius: 50%;
            padding: 4px;
            background: conic-gradient(from 200deg, var(--navy), var(--gold), var(--navy-mid), var(--navy-deep), var(--navy));
            box-shadow: 0 4px 10px rgba(15, 33, 64, 0.25);
          }
          .seal-inner {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .seal-inner img { width: 100%; height: 100%; object-fit: contain; }
          .seal-initials { font-size: 15pt; font-weight: 800; color: var(--navy-deep); }
          .letterhead-center { flex: 1; text-align: center; }
          .org-name { font-size: 14pt; font-weight: 800; color: var(--navy-deep); letter-spacing: 0.01em; }
          .system-name { font-size: 10pt; font-weight: 700; color: var(--navy-mid); margin-top: 4px; }
          .org-place { font-size: 8pt; color: var(--ink-soft); margin-top: 2px; letter-spacing: 0.03em; }
          .ref-wrap { flex: 0 0 auto; text-align: center; }
          .ref-label { font-size: 7.5pt; font-weight: 700; color: var(--ink-soft); margin-bottom: 5px; }
          .ref-badge {
            display: inline-block;
            background: linear-gradient(120deg, var(--navy), var(--navy-deep));
            color: #ffffff;
            font-weight: 800;
            font-family: 'Courier New', monospace;
            direction: ltr;
            unicode-bidi: isolate;
            padding: 8px 16px;
            border-radius: 999px;
            font-size: 11pt;
            box-shadow: 0 3px 8px rgba(15, 33, 64, 0.25);
          }

          /* ---- subject strip ---- */
          .subject-strip {
            display: flex;
            align-items: center;
            gap: 16px;
            background: linear-gradient(120deg, var(--navy-deep), var(--navy) 55%, var(--navy-mid));
            border-radius: 14px;
            padding: 14px 20px;
            margin: 18px 0;
            color: #ffffff;
          }
          .subject-eyebrow {
            flex: 0 0 auto;
            font-size: 8pt;
            font-weight: 800;
            color: var(--gold-soft);
            letter-spacing: 0.08em;
            background: rgba(255, 255, 255, 0.08);
            padding: 6px 12px;
            border-radius: 999px;
            border: 1px solid rgba(217, 194, 132, 0.35);
            white-space: nowrap;
          }
          .subject-value { flex: 1; font-size: 12.5pt; font-weight: 800; line-height: 1.6; }

          /* ---- data table ---- */
          .table-wrap { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
          .data-table { width: 100%; border-collapse: collapse; }
          .data-table td { padding: 9px 14px; border-bottom: 1px solid var(--line-soft); font-size: 9.5pt; vertical-align: top; }
          .data-table tr:last-child td { border-bottom: none; }
          .dt-label { background: var(--stripe); color: var(--navy); font-weight: 700; width: 17%; white-space: nowrap; border-inline-start: 1px solid var(--line-soft); }
          .dt-label:first-child { border-inline-start: none; }
          .dt-value { color: var(--ink); font-weight: 600; width: 33%; }
          .status-approved { color: #166534; font-weight: 800; }
          .status-pending { color: var(--gold); font-weight: 800; }
          .status-rejected { color: #b91c1c; font-weight: 800; }
          .status-default { color: var(--ink); font-weight: 700; }

          /* ---- cards ---- */
          .card { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-top: 16px; }
          .card-header {
            background: var(--stripe);
            color: var(--navy);
            font-weight: 800;
            font-size: 9.5pt;
            padding: 9px 16px;
            border-bottom: 1px solid var(--line);
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .card-body { padding: 14px 16px; }
          .card-body .field-label { font-size: 8.5pt; font-weight: 700; color: var(--ink-soft); margin-bottom: 4px; display: block; }
          .card-body p { font-size: 10.5pt; line-height: 1.85; color: var(--ink); white-space: pre-wrap; }
          .text-block { margin-bottom: 12px; }
          .text-block:last-child { margin-bottom: 0; }
          .empty-note { font-size: 9.5pt; color: var(--ink-soft); font-style: italic; }

          .att-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--line-soft); }
          .att-row:last-child { border-bottom: none; }
          .att-chip { flex: 0 0 auto; min-width: 42px; text-align: center; font-size: 7.5pt; font-weight: 800; padding: 4px 8px; border-radius: 6px; }
          .att-name { flex: 1; font-size: 10pt; font-weight: 600; color: var(--ink); }
          .att-note { font-size: 8pt; color: var(--ink-soft); white-space: nowrap; }

          .signature-img { max-width: 200px; max-height: 70px; }

          /* ---- footer ---- */
          .sheet-footer {
            margin-top: auto;
            padding-top: 12px;
            border-top: 1px solid var(--line);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }
          .footer-meta { font-size: 7.5pt; color: var(--ink-soft); line-height: 1.7; }
          .footer-meta strong { color: var(--navy); }
          .footer-barcode { display: flex; flex-direction: column; align-items: center; gap: 3px; }
          .footer-barcode svg { max-width: 150px; height: auto; }
          .footer-barcode span { font-family: 'Courier New', monospace; direction: ltr; unicode-bidi: isolate; font-size: 8pt; font-weight: 700; color: var(--ink); }

          /* ---- attachment (page 2+) sheets ---- */
          .p2-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--line);
            margin-bottom: 16px;
          }
          .p2-file-name { font-size: 11pt; font-weight: 800; color: var(--navy-deep); }
          .p2-file-sub { font-size: 8pt; color: var(--ink-soft); margin-top: 2px; }
          .p2-follow-badge {
            font-size: 8.5pt;
            font-weight: 700;
            color: var(--navy);
            background: var(--stripe);
            padding: 6px 14px;
            border-radius: 999px;
            border: 1px solid var(--line);
            white-space: nowrap;
          }
          .p2-frame {
            flex: 1;
            min-height: 0;
            border: 2px dashed var(--line);
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            background: #ffffff;
          }
          .p2-frame.has-content { border-style: solid; }
          .p2-frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
          .p2-frame embed { width: 100%; height: 100%; border: 0; }
          .p2-placeholder { text-align: center; color: var(--ink-soft); padding: 40px; }
          .p2-placeholder .icon { font-size: 26pt; margin-bottom: 10px; }
          .p2-placeholder p { font-size: 10pt; line-height: 1.8; max-width: 340px; margin: 0 auto; }

          /* DOCX content flows as normal text rather than being centered/clipped
             like image and PDF frames — long documents overflow the sheet's
             min-height and continue onto additional printed pages naturally. */
          .p2-frame.docx-frame {
            display: block;
            align-items: initial;
            justify-content: initial;
            overflow: visible;
            border: none;
            padding: 0;
          }
          .docx-print-content { font-size: 10pt; line-height: 1.8; color: var(--ink); text-align: right; }
          .docx-print-content img { max-width: 100%; height: auto; }
          .docx-print-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
          .docx-print-content table td, .docx-print-content table th { border: 1px solid var(--line); padding: 4px 8px; }
          .docx-print-content p { margin: 0 0 8px; }

          @media print {
            html, body { background: #ffffff; padding: 0; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .sheet { box-shadow: none; margin: 0; }
            .sheet:not(:first-child) { page-break-before: always; }
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="letterhead">
            <div class="seal"><div class="seal-inner">${logoBlock}</div></div>
            <div class="letterhead-center">
              <div class="org-name">مركز البنيان لتقنية والصناعات الهندسية</div>
              <div class="system-name">نظام الأرشيف الإلكتروني</div>
              <div class="org-place">مصراتة — ليبيا</div>
            </div>
            <div class="ref-wrap">
              <div class="ref-label">الرقم الإشاري</div>
              <div class="ref-badge">${this.escapeHtml(doc.ref_number)}</div>
            </div>
          </div>

          <div class="subject-strip">
            <span class="subject-eyebrow">الموضوع</span>
            <span class="subject-value">${this.escapeHtml(doc.subject)}</span>
          </div>

          <div class="table-wrap">
            <table class="data-table">
              <tbody>
                <tr>${this.dataCell('نوع الوثيقة', typeLabel)}${this.dataCell('التصنيف', classification)}</tr>
                <tr>${this.dataCell('مستوى السرية', doc.confidentiality)}${this.dataCell('الحالة', doc.status, this.statusClass(doc.status))}</tr>
                <tr>${this.dataCell('التاريخ', doc.date)}${this.dataCell('طريقة الاستلام', doc.input_method ? this.inputMethodLabel(doc.input_method) : '')}</tr>
                <tr>${this.dataCell('المرسل', doc.sender || '')}${this.dataCell('المستلم', doc.receiver || '')}</tr>
                <tr>
                  <td class="dt-label">منشئ الرسالة</td>
                  <td class="dt-value" colspan="3">${doc.author ? this.escapeHtml(doc.author) : '—'}</td>
                </tr>
                ${doc.writer_name ? `
                <tr>
                  <td class="dt-label">معد الرسالة</td>
                  <td class="dt-value" colspan="3">${this.escapeHtml(doc.writer_name)}</td>
                </tr>` : ''}
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="card-header"><span>محتوى الوثيقة</span></div>
            <div class="card-body">${contentBody}</div>
          </div>

          ${doc.notes ? `
          <div class="card">
            <div class="card-header"><span>ملاحظات</span></div>
            <div class="card-body"><p>${this.escapeHtml(doc.notes)}</p></div>
          </div>` : ''}

          <div class="card">
            <div class="card-header">
              <span>المرفقات</span>
              <span>${attachments.length} ${attachments.length === 1 ? 'ملف' : 'ملفات'}</span>
            </div>
            <div class="card-body">
              ${attachments.length ? attachments.map((a, i) => this.buildAttachmentRow(a, docxHtmlByIndex.get(i))).join('') : '<p class="empty-note">لا توجد مرفقات لهذه الوثيقة.</p>'}
            </div>
          </div>

          ${signatureSrc ? `
          <div class="card">
            <div class="card-header"><span>التوقيع الإلكتروني</span></div>
            <div class="card-body"><img src="${signatureSrc}" class="signature-img" alt="التوقيع"></div>
          </div>` : ''}

          ${this.buildBarcodeFooter(doc, printedAt, printedBy)}
        </div>

        ${attachmentSheets}
      </body>
      </html>
    `;
  }
}
