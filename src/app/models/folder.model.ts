export interface Folder {
  id: number;
  name: string;
  group_name: string;
  is_system?: number;
  is_active?: number;
  created_by?: number;
  created_at?: number;
  updated_at?: number;
  document_count?: number;
}

export interface FolderInput {
  name: string;
  group_name: string;
  is_active?: number;
}
