export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export type UserRole =
  | 'super_admin'
  | 'business_owner'
  | 'manager'
  | 'reception'
  | 'therapist'
  | 'trainer'
  | 'customer';
