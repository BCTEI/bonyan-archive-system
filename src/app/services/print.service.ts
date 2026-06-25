import { Injectable } from '@angular/core';
import { ArchiveDocument, Attachment } from '../models/document.model';
import { User } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class PrintService {
  printDocument(doc: ArchiveDocument, folderName: string, user: User | null) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('تم حظر نافذة الطباعة، يرجى السماح بالنوافذ المنبثقة');
      return;
    }

    printWindow.document.write(this.generatePrintHTML(doc, folderName, user));
    printWindow.document.close();

    // Wait for images to load then print
    setTimeout(() => {
      printWindow.print();
    }, 600);
  }

  private generatePrintHTML(doc: ArchiveDocument, folderName: string, user: User | null): string {
    const attachments: Attachment[] = [];
    try {
      const parsed = JSON.parse(doc.attachments_json);
      if (Array.isArray(parsed)) attachments.push(...parsed);
    } catch {
      // ignore
    }

    const typeLabel = doc.type_label ?? doc.type ?? '—';
    const typeIcon = doc.type_icon ?? '';
    const confidentialityEmoji = doc.confidentiality === 'عادي' ? '🟢' : doc.confidentiality === 'سري' ? '🟡' : '🔴';
    const statusEmoji = doc.status === 'معتمد' ? '✅' : '⏳';
    const printedAt = new Date().toLocaleString('ar-LY');

    return `
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>تقرير وثيقة - ${doc.ref_number}</title>
        <style>
          @page { size: A4; margin: 15mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Tajawal', Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #1e293b; background: #f1f5f9; }
          .page { width: 210mm; min-height: 297mm; padding: 20mm; margin: 0 auto; background: white; }
          .header { text-align: center; border-bottom: 3px solid #1e3a5f; padding-bottom: 15px; margin-bottom: 20px; }
          .header h1 { font-size: 18pt; color: #1e3a5f; margin-bottom: 5px; }
          .header h2 { font-size: 14pt; color: #64748b; font-weight: 400; }
          .section { border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
          .section-title { font-size: 13pt; font-weight: 700; color: #1e3a5f; margin-bottom: 10px; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; }
          .field-row { display: flex; margin-bottom: 8px; }
          .field-label { font-weight: 700; color: #64748b; width: 140px; }
          .field-value { flex: 1; font-weight: 600; }
          .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 10pt; font-weight: 700; }
          .badge-approved { background: #d1fae5; color: #059669; }
          .badge-pending { background: #fef3c7; color: #d97706; }
          .badge-secret { background: #fee2e2; color: #dc2626; }
          .badge-top-secret { background: #7f1d1d; color: #ffffff; }
          .badge-normal { background: #d1fae5; color: #059669; }
          .signature-box { border: 2px dashed #cbd5e1; border-radius: 8px; padding: 15px; text-align: center; min-height: 100px; }
          .signature-img { max-width: 300px; max-height: 100px; }
          .attachments-list { list-style: none; padding: 0; }
          .attachments-list li { padding: 4px 0; border-bottom: 1px solid #e2e8f0; }
          .attachments-list li:last-child { border-bottom: none; }
          .qr-code { text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1; }
          .qr-placeholder { width: 120px; height: 120px; border: 1px solid #cbd5e1; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 9pt; }
          .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 9pt; color: #64748b; text-align: center; }
          .cut-line { border-top: 1px dashed #cbd5e1; margin: 20px 0; text-align: center; color: #94a3b8; font-size: 9pt; }
          @media print { body { background: white; } .page { margin: 0; box-shadow: none; width: 100%; } }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <h1>🏛️ مركز البنيان لتقنية والصناعيات الهندسية</h1>
            <h2>📋 نظام الأرشيف الإلكتروني — مصراتة</h2>
          </div>

          <div class="section">
            <div class="section-title">📄 معلومات الوثيقة</div>
            <div class="field-row">
              <span class="field-label">الرقم الإشاري:</span>
              <span class="field-value" style="font-family:monospace;font-size:14pt">${doc.ref_number}</span>
            </div>
            <div class="field-row">
              <span class="field-label">النوع:</span>
              <span class="field-value">${typeIcon} ${typeLabel}</span>
            </div>
            <div class="field-row">
              <span class="field-label">مستوى السرية:</span>
              <span class="field-value">
                <span class="badge ${doc.confidentiality === 'سري للغاية' ? 'badge-top-secret' : doc.confidentiality === 'سري' ? 'badge-secret' : 'badge-normal'}">
                  ${confidentialityEmoji} ${doc.confidentiality}
                </span>
              </span>
            </div>
            <div class="field-row">
              <span class="field-label">الحالة:</span>
              <span class="field-value">
                <span class="badge ${doc.status === 'معتمد' ? 'badge-approved' : 'badge-pending'}">
                  ${statusEmoji} ${doc.status}
                </span>
              </span>
            </div>
          </div>

          <div class="section">
            <div class="section-title">📋 التفاصيل</div>
            <div class="field-row"><span class="field-label">📅 التاريخ:</span><span class="field-value">${doc.date}</span></div>
            <div class="field-row"><span class="field-label">📤 المرسل:</span><span class="field-value">${doc.sender || '—'}</span></div>
            <div class="field-row"><span class="field-label">📥 المستلم:</span><span class="field-value">${doc.receiver || '—'}</span></div>
            <div class="field-row"><span class="field-label">📝 الموضوع:</span><span class="field-value">${doc.subject}</span></div>
            <div class="field-row"><span class="field-label">✍️ المؤلف:</span><span class="field-value">${doc.author || '—'}</span></div>
            <div class="field-row"><span class="field-label">📁 المجلد:</span><span class="field-value">${folderName}</span></div>
          </div>

          ${doc.notes ? `
          <div class="section">
            <div class="section-title">📌 ملاحظات</div>
            <p>${doc.notes.replace(/\n/g, '<br>')}</p>
          </div>` : ''}

          ${attachments.length ? `
          <div class="section">
            <div class="section-title">📎 المرفقات (${attachments.length})</div>
            <ul class="attachments-list">
              ${attachments.map(a => `<li>• ${a.name}.${a.ext}</li>`).join('')}
            </ul>
          </div>` : ''}

          ${doc.signature_base64 ? `
          <div class="section">
            <div class="section-title">✍️ التوقيع الإلكتروني</div>
            <div class="signature-box">
              <img src="${doc.signature_base64}" class="signature-img" alt="التوقيع">
            </div>
          </div>` : ''}

          <div class="cut-line">──────── ✂️ قص هنا ────────</div>

          <div class="qr-code">
            <div class="qr-placeholder">QR<br>${doc.ref_number}</div>
            <p style="font-size:9pt;color:#64748b;margin-top:8px">امسح الرمز للتحقق من الوثيقة</p>
          </div>

          <div class="footer">
            <p>🖨️ تاريخ الطباعة: ${printedAt} | 👤 طبع بواسطة: ${user?.username || '—'}</p>
            <p>📱 Bonyan Electronic Archive System</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
