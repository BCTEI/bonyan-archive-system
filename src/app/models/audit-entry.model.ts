export interface AuditEntry {
  id?: number;
  action: string;
  doc_ref?: string;
  details?: string;
  username?: string;
  timestamp?: string;
}
