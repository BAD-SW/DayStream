/** Phase 44, requirements 8 and 9: a business's languages and the translations of its offerings. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminPool } from '../src/db/pool';
import { getBusinessLanguages, setBusinessLanguages } from '../src/services/business-languages.service';
import { getTranslationTable, saveTranslation, localizeOfferings, localizeNames, TranslationError } from '../src/services/offering-translations.service';

let BUSINESS_ID: string;
let serviceId: string;
let serviceName: string;
let languagesBefore: string[];

describe('offering translations', () => {
  beforeAll(async () => {
    const { rows } = await adminPool.query(`SELECT id, name, business_id FROM svc_services WHERE status = 'active' ORDER BY created_at LIMIT 1`);
    BUSINESS_ID = rows[0].business_id;
    serviceId = rows[0].id;
    serviceName = rows[0].name;
    const b = await adminPool.query('SELECT languages FROM sys_businesses WHERE id = $1', [BUSINESS_ID]);
    languagesBefore = b.rows[0].languages;
    await setBusinessLanguages(BUSINESS_ID, ['en', 'es']);
    await adminPool.query(`DELETE FROM cat_translations WHERE entity_type = 'service' AND entity_id = $1`, [serviceId]);
  });

  afterAll(async () => {
    await adminPool.query(`DELETE FROM cat_translations WHERE entity_type = 'service' AND entity_id = $1`, [serviceId]);
    if (BUSINESS_ID && languagesBefore) await adminPool.query('UPDATE sys_businesses SET languages = $2 WHERE id = $1', [BUSINESS_ID, languagesBefore]);
  });

  it('keeps the default language first and drops languages not on the list', async () => {
    const saved = await setBusinessLanguages(BUSINESS_ID, ['es', 'xx']);
    expect(saved?.languages[0]).toBe(saved?.defaultLanguage);
    expect(saved?.languages).not.toContain('xx');
    expect((await getBusinessLanguages(BUSINESS_ID))?.languages).toEqual(saved?.languages);
  });

  it('shows the original and a row for each other language', async () => {
    const table = await getTranslationTable('service', serviceId, BUSINESS_ID);
    expect(table.original.name).toBe(serviceName);
    expect(table.fields).toEqual(['name', 'short_description', 'description']);
    expect(table.rows.map((r) => r.language)).toEqual(['es']);
    expect(table.rows[0].translatedBy).toBeNull();
  });

  it('saves a translation and marks it out of date when the original changes', async () => {
    await saveTranslation('service', serviceId, BUSINESS_ID, 'es', { fields: { name: 'Masaje de prueba' }, translatedBy: 'machine' }, null);
    let table = await getTranslationTable('service', serviceId, BUSINESS_ID);
    expect(table.rows[0]).toMatchObject({ language: 'es', translatedBy: 'machine', outOfDate: false });
    expect(table.rows[0].fields.name).toBe('Masaje de prueba');
    await adminPool.query(`UPDATE cat_translations SET source = jsonb_set(source, '{name}', '"An older name"') WHERE entity_type = 'service' AND entity_id = $1`, [serviceId]);
    table = await getTranslationTable('service', serviceId, BUSINESS_ID);
    expect(table.rows[0].outOfDate).toBe(true);
  });

  it('refuses a language the business does not support, and a record of another business', async () => {
    await expect(saveTranslation('service', serviceId, BUSINESS_ID, 'fr', { fields: {} }, null)).rejects.toBeInstanceOf(TranslationError);
    await expect(getTranslationTable('service', serviceId, '00000000-0000-0000-0000-0000000000ff')).rejects.toBeInstanceOf(TranslationError);
  });

  it('shows customers the translation, and the original where there is none', async () => {
    const rows = [{ id: serviceId, name: serviceName, price: 100 }, { id: '00000000-0000-0000-0000-00000000abcd', name: 'Other', price: 50 }];
    const es = await localizeOfferings('service', rows, 'es');
    expect(es[0]).toMatchObject({ name: 'Masaje de prueba', price: 100 });
    expect(es[1].name).toBe('Other');
    expect((await localizeOfferings('service', rows, 'en'))[0].name).toBe(serviceName);
    const named = await localizeNames([{ service_id: serviceId, service_name: serviceName }], [{ entity: 'service', idKey: 'service_id', nameKey: 'service_name' }], 'es');
    expect(named[0].service_name).toBe('Masaje de prueba');
  });
});
