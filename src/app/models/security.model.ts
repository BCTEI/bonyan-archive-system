// UserCodeEntry is declared once in src/types/electron.d.ts (the IPC contract
// shared with the main process) — reused here instead of redeclared to avoid
// two drifting copies of the same shape.
import type { UserCodeEntry } from '../../types/electron';

export type { UserCodeEntry };

export type CodeStatus = UserCodeEntry['status'];

export const CODE_STATUS_LABELS: Record<CodeStatus, string> = {
  active: 'فعال',
  used: 'مستخدم',
  revoked: 'ملغي',
  expired: 'منتهي'
};

export interface DocumentAccessLogEntry {
  id?: number;
  document_id: number;
  user_id: number;
  user_username: string;
  access_type: 'view' | 'edit';
  confidentiality_level: string;
  verification_method?: string;
  timestamp?: number;
}
