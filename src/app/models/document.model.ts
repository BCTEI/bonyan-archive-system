export type DocumentType = 'صادر' | 'وارد' | 'مراسلات';
export type DocumentStatus = 'معتمد' | 'قيد الاعتماد';

export interface Attachment {
  name: string;
  ext: string;
  size: number;
  base64: string;
}

export interface ArchiveDocument {
  id?: number;
  ref_number: string;
  type: DocumentType;
  folder_id: number;
  subject: string;
  sender?: string;
  receiver?: string;
  author?: string;
  address?: string;
  target?: string;
  content?: string;
  input_method?: 'upload' | 'camera' | 'scanner';
  date: string;
  body?: string;
  notes?: string;
  status: DocumentStatus;
  signature_base64?: string;
  attachments_json: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
}
