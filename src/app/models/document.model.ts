export type DocumentTypeName = 'صادر' | 'وارد' | 'مراسلات';
// 'موقوف' (suspended) is the non-destructive end state set by the suspend
// action (formerly "delete"): the row, its ref number, attachments and
// metadata all stay in the archive — it is only hidden from the active list.
export type DocumentStatus = 'معتمد' | 'قيد الاعتماد' | 'موقوف';

export const SUSPENDED_STATUS: DocumentStatus = 'موقوف';
export type ConfidentialityLevel = 'عادي' | 'سري' | 'سري للغاية';

export interface Attachment {
  name: string;
  ext: string;
  size: number;
  base64: string;
}

export interface DocumentTypeEntry {
  id: number;
  name: string;
  label: string;
  color: string;
  icon: string;
  prefix: string;
  is_active: number;
  is_system: number;
  created_at: number;
}

export interface ArchiveDocument {
  id?: number;
  ref_number: string;
  type_id: number;
  type?: string;
  type_label?: string;
  type_color?: string;
  type_icon?: string;
  folder_id: number;
  confidentiality: ConfidentialityLevel;
  subject: string;
  sender?: string;
  receiver?: string;
  message_author?: string;
  message_preparer?: string;
  address?: string;
  target?: string;
  content?: string;
  input_method?: 'upload' | 'camera' | 'scanner';
  date: string;
  body?: string;
  notes?: string;
  status: DocumentStatus;
  barcode?: string;
  signature_base64?: string;
  attachments_json: string;
  // Shim added by the backend SELECT (document:getAll, annualClosing:getArchivedDocuments/
  // getArchivedDocumentById) so callers can show an accurate attachment count even when
  // attachments_json itself is stripped (unverified top-secret rows) or omitted entirely
  // (archive list rows never include attachments_json — see AnnualClosingService).
  attachments_count?: number;
  // Boolean shim for list rows (document:getAll), which omit signature_base64
  // itself — lets cards show the "signed" badge without shipping the signature.
  has_signature?: number;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  org_unit_id?: number | null;
  locked?: boolean;
  // Archive year this document was actually registered under (set server-side
  // at creation from the active archive year) — the basis annual closing uses
  // to decide what belongs to a year, independent of the editable `date` field.
  archive_year?: number;
}
