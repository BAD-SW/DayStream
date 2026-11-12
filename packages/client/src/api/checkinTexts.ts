import { apiClient } from './client';

/** The wording of the customer check-in screens (spec 51, gap 3): only what the business changed. */
export interface CheckInTextOverrides {
  language: string;
  overrides: Record<string, string>;
}

export async function getCheckInTexts(businessId: string, language: string): Promise<CheckInTextOverrides> {
  const res = await apiClient.get('/v1/checkin-texts', { params: { business_id: businessId, language } });
  return res.data.data;
}

export async function saveCheckInTexts(businessId: string, language: string, texts: Record<string, string>): Promise<CheckInTextOverrides> {
  const res = await apiClient.put('/v1/checkin-texts', { business_id: businessId, language, texts });
  return res.data.data;
}
