export interface ArchivedYear {
  year: number;
  archived_at?: number;
  archived_by?: number;
  archived_by_name?: string;
  document_count?: number;
  backup_path?: string;
  notes?: string;
}
