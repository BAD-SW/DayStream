export interface User {
  id: string;
  tenant_id: string;
  business_id: string | null;
  email: string;
  first_name: string;
  last_name: string;
  persona: Persona;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export type Persona = 'system' | 'tenant' | 'business' | 'customer';

export type UserRole =
  | 'system_admin'
  | 'system_support'
  | 'tenant_owner'
  | 'tenant_manager'
  | 'business_owner'
  | 'business_manager'
  | 'business_staff'
  | 'customer';
