import { apiClient } from './client';

// A customer's packages and their use (spec 51, gap 19): the customer's Packages tab.

export interface PackageUse {
  /** A redemption (used) or an upcoming appointment holding the allowance (booked). */
  kind: 'used' | 'booked';
  at: string;
  quantity: number;
  minutes: number | null;
  note: string | null;
  booking: {
    id: string; reference: string | null; start_time: string; status: string;
    service_name: string | null; variant_name: string | null; staff_name: string | null;
  } | null;
  order: { id: string; order_number: string } | null;
}

export interface CustomerPackageItem {
  item_id: string;
  item_type: 'service' | 'merchandise';
  name: string;
  variant_name: string | null;
  unit: 'sessions' | 'minutes';
  total: number;
  used: number;
  /** Held by upcoming appointments, not used yet. */
  booked: number;
  left: number;
  uses: PackageUse[];
}

export interface CustomerPackage {
  purchase_id: string;
  package_id: string;
  name: string;
  description: string | null;
  /** active, expired, used up, or the purchase's own status (cancelled, pending...). */
  status: string;
  purchased_at: string;
  expires_at: string | null;
  order: { id: string; order_number: string } | null;
  items: CustomerPackageItem[];
}

export async function getCustomerPackages(customerId: string, businessId: string): Promise<CustomerPackage[]> {
  const res = await apiClient.get(`/v1/packages/purchases/customer/${customerId}/usage`, { params: { business_id: businessId } });
  return res.data.data;
}
