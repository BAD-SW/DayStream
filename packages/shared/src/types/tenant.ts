export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  default_language: string;
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}
