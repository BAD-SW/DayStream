import { apiClient } from './client';

/** Service add-ons (spec 51, gap 15): a name, a description and a price, added on the service. */
export interface ServiceAddon {
  id: string;
  /** the same as id (the name the booking screens use) */
  addon_id: string;
  service_id: string;
  name: string;
  description: string | null;
  price: number;
  display_order: number;
}

/** A service's add-ons, in its order. */
export async function getServiceAddons(serviceId: string, businessId: string): Promise<ServiceAddon[]> {
  const res = await apiClient.get(`/v1/services/${serviceId}/addons`, { params: { business_id: businessId } });
  return res.data.data;
}

/** Save a service's add-ons as listed: with addon_id kept and edited, without it added; left out, removed. */
export async function setServiceAddons(
  serviceId: string, businessId: string,
  addons: Array<{ addon_id?: string | null; name: string; description?: string | null; price: number }>,
): Promise<ServiceAddon[]> {
  const res = await apiClient.put(`/v1/services/${serviceId}/addons?business_id=${businessId}`, { addons });
  return res.data.data;
}
