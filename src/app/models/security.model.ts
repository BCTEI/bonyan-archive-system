export interface VerificationCode {
  id?: number;
  code?: string;
  code_hash?: string;
  generated_at?: number;
  expires_at?: number;
  is_active?: number;
  generated_by?: number;
}

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
