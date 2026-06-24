export type DocumentTypeName = 'صادر' | 'وارد' | 'مراسلات';
export type DocumentStatus = 'معتمد' | 'قيد الاعتماد';
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
