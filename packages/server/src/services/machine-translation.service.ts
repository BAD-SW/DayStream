import { adminPool } from '../db/pool';
import { msg } from '../i18n';

/**
 * Google Cloud Translation (Basic, v2) for the Translate buttons of the offerings (Phase 44,
 * requirement 9.7): called only when someone presses Translate, with the platform's Google key (the
 * one held for Places), within the platform's daily limit. Plain text in, plain text out.
 */

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

export class MachineTranslationError extends Error {
  constructor(message: string, public code: 'NO_KEY' | 'REFUSED' | 'FAILED') {
    super(message);
    this.name = 'MachineTranslationError';
  }
}

async function apiKey(): Promise<string> {
  if (process.env.GOOGLE_TRANSLATE_API_KEY) return process.env.GOOGLE_TRANSLATE_API_KEY;
  const { rows } = await adminPool.query(`SELECT config_data FROM sys_system_configurations WHERE category = 'api_keys'`);
  const key = rows[0]?.config_data?.google_places;
  if (typeof key === 'string' && key) return key;
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY;
  throw new MachineTranslationError(msg('errors:translation.noKey'), 'NO_KEY');
}

const decodeHtml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

/** Translate texts from one language to another; empty texts stay empty and are not sent. */
export async function translateTexts(texts: string[], source: string, target: string): Promise<string[]> {
  const indexes = texts.map((t, i) => (t && t.trim() ? i : -1)).filter((i) => i >= 0);
  if (indexes.length === 0) return texts.map(() => '');
  const key = await apiKey();
  let body: { data?: { translations?: { translatedText: string }[] }; error?: { message?: string } };
  let ok = false;
  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: indexes.map((i) => texts[i]), source, target, format: 'text' }),
    });
    ok = res.ok;
    body = await res.json() as typeof body;
  } catch {
    throw new MachineTranslationError(msg('errors:translation.failed'), 'FAILED');
  }
  if (!ok || !body.data?.translations) {
    // Over the daily limit, or the key not allowed to use the service.
    throw new MachineTranslationError(msg('errors:translation.refused'), 'REFUSED');
  }
  const out = texts.map(() => '');
  body.data.translations.forEach((t, n) => { out[indexes[n]] = decodeHtml(t.translatedText); });
  return out;
}
