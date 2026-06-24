export interface PasswordResetRequest {
  id?: number;
  user_id: number;
  username: string;
  request_date?: number;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: number;
  approved_at?: number;
  new_password_hash?: string;
}
