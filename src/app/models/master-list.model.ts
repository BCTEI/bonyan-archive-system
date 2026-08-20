export type MasterListType = 'message_author' | 'preparer' | 'sender' | 'receiver' | 'department';

export interface MasterListEntry {
  id: number;
  list_type: MasterListType;
  name: string;
  name_en?: string | null;
  is_active: number;
  created_at?: number;
}

export interface MasterListInput {
  list_type: MasterListType;
  name: string;
  name_en?: string | null;
  is_active?: number;
}
