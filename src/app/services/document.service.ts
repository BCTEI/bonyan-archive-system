import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { ArchiveDocument, Attachment, DocumentType } from '../models/document.model';

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  constructor(private db: DatabaseService) {}

  async getAll(): Promise<ArchiveDocument[]> {
    return this.db.getDocuments();
  }

  async getById(id: number): Promise<ArchiveDocument | undefined> {
    return this.db.getDocumentById(id);
  }

  async create(doc: ArchiveDocument): Promise<number> {
    const result = await this.db.run(`
      INSERT INTO documents (
        ref_number, type, folder_id, subject, sender, receiver, author, address, target, content, input_method,
        date, body, notes,
        status, signature_base64, attachments_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      doc.ref_number,
      doc.type,
      doc.folder_id,
      doc.subject,
      doc.sender ?? null,
      doc.receiver ?? null,
      doc.author ?? null,
      doc.address ?? null,
      doc.target ?? null,
      doc.content ?? null,
      doc.input_method ?? null,
      doc.date,
      doc.body ?? null,
      doc.notes ?? null,
      doc.status,
      doc.signature_base64 ?? null,
      doc.attachments_json,
      doc.created_by ?? null
    ]);
    return Number(result.lastInsertRowid);
  }

  async update(doc: ArchiveDocument): Promise<void> {
    if (!doc.id) {
      throw new Error('Document id required');
    }
    await this.db.run(`
      UPDATE documents SET
        ref_number = ?, type = ?, folder_id = ?, subject = ?, sender = ?, receiver = ?,
        author = ?, address = ?, target = ?, content = ?, input_method = ?,
        date = ?, body = ?, notes = ?, status = ?, signature_base64 = ?, attachments_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      doc.ref_number,
      doc.type,
      doc.folder_id,
      doc.subject,
      doc.sender ?? null,
      doc.receiver ?? null,
      doc.author ?? null,
      doc.address ?? null,
      doc.target ?? null,
      doc.content ?? null,
      doc.input_method ?? null,
      doc.date,
      doc.body ?? null,
      doc.notes ?? null,
      doc.status,
      doc.signature_base64 ?? null,
      doc.attachments_json,
      doc.id
    ]);
  }

  async delete(id: number): Promise<void> {
    await this.db.run('DELETE FROM documents WHERE id = ?', [id]);
  }

  async getNextRef(type: DocumentType, folderId: number): Promise<string> {
    return this.db.getNextRef(type, folderId);
  }

  parseAttachments(doc: ArchiveDocument): Attachment[] {
    try {
      return JSON.parse(doc.attachments_json) as Attachment[];
    } catch {
      return [];
    }
  }
}
