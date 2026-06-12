export interface Business {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
  primary_color: string | null;
  logo_url: string | null;
  default_language: string;
  currency: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}
