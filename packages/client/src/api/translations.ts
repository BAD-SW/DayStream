import { apiClient } from './client';
import type { TranslatableEntity, TranslatableField, TranslationFields } from '@daystream/shared';

/** Translations of a business's offerings (Phase 44, requirement 9). */

export interface TranslationRow {
  language: string;
  fields: TranslationFields;
  translatedBy: 'machine' | 'person' | null;
  outOfDate: boolean;
  updatedAt: string | null;
}

export interface TranslationTable {
  entityType: TranslatableEntity;
  fields: TranslatableField[];
  defaultLanguage: string;
  original: TranslationFields;
  rows: TranslationRow[];
}

export async function getTranslations(businessId: string, entity: TranslatableEntity, id: string): Promise<TranslationTable> {
  const res = await apiClient.get(`/v1/translations/${entity}/${id}`, { params: { business_id: businessId } });
  return res.data.data;
}

export async function saveTranslation(
  businessId: string, entity: TranslatableEntity, id: string, language: string,
  fields: TranslationFields, translatedBy: 'machine' | 'person',
): Promise<TranslationRow> {
  const res = await apiClient.put(`/v1/translations/${entity}/${id}/${language}`, { fields, translated_by: translatedBy }, { params: { business_id: businessId } });
  return res.data.data;
}

/** Google's translation of the default-language text (not saved). */
export async function machineTranslate(businessId: string, entity: TranslatableEntity, id: string, language: string): Promise<TranslationFields> {
  const res = await apiClient.post(`/v1/translations/${entity}/${id}/${language}/translate`, {}, { params: { business_id: businessId } });
  return res.data.data;
}

/** A business's languages (requirement 8): its default first, then the others it supports. */
export interface BusinessLanguagesData { default_language: string; languages: string[] }

export async function getBusinessLanguages(businessId: string): Promise<BusinessLanguagesData> {
  const res = await apiClient.get(`/v1/admin/businesses/${businessId}/languages`);
  return res.data.data;
}

export async function setBusinessLanguages(businessId: string, languages: string[]): Promise<BusinessLanguagesData> {
  const res = await apiClient.put(`/v1/admin/businesses/${businessId}/languages`, { languages });
  return res.data.data;
}
