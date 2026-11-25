/**
 * npm run translate (Phase 44, requirement 6; design section 8)
 *
 * Fills the translation files of every language other than English with Google Cloud Translation:
 * only phrases with no translation yet are sent, so a corrected translation is never changed.
 *
 *   npm run translate                    every language in TRANSLATED_LANGUAGES except English
 *   npm run translate -- --lang es       one language
 *   npm run translate -- --dry-run       report what would be sent and the character count; send nothing
 *   npm run translate -- --key <key>     use this API key
 *
 * The key: --key, else GOOGLE_TRANSLATE_API_KEY, else the platform's Google key in System Configuration
 * (sys_system_configurations, api_keys.google_places) in the database of this environment.
 * The Cloud Translation API must be switched on for that key's Google Cloud project.
 */
import fs from 'fs';
import path from 'path';
import { TRANSLATED_LANGUAGES, DEFAULT_LANGUAGE, languageLocale, neededKeys, placeholdersOf } from '@daystream/shared';
import type { TranslationBundle } from '@daystream/shared';

const ROOT = path.resolve(__dirname, '../../..');
const LOCALE_ROOTS = [
  path.join(ROOT, 'packages/client/src/i18n/locales'),
  path.join(ROOT, 'packages/server/src/i18n/locales'),
];
const GLOSSARY_FILE = path.join(__dirname, 'i18n-glossary.json');
const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const BATCH_PHRASES = 100;
const BATCH_CHARS = 20000;

interface Glossary {
  /** Words kept as they are in every language (product names). */
  keep: string[];
  /** Whole phrases or words always translated the same way: language → English → translation. */
  fixed: Record<string, Record<string, string>>;
}

// ─── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = flag('dry-run');
const onlyLanguage = option('lang');
const targets = (TRANSLATED_LANGUAGES as readonly string[]).filter((l) => l !== DEFAULT_LANGUAGE && (!onlyLanguage || l === onlyLanguage));
if (onlyLanguage && targets.length === 0) {
  console.error(`"${onlyLanguage}" is not in TRANSLATED_LANGUAGES (packages/shared/src/constants/supported.ts).`);
  process.exit(1);
}

// ─── The API key ─────────────────────────────────────────────────────────────

async function apiKey(): Promise<string> {
  const given = option('key') ?? process.env.GOOGLE_TRANSLATE_API_KEY;
  if (given) return given;
  const { adminPool } = await import('../src/db/pool');
  try {
    const { rows } = await adminPool.query(`SELECT config_data FROM sys_system_configurations WHERE category = 'api_keys'`);
    const key = rows[0]?.config_data?.google_places;
    if (typeof key === 'string' && key) return key;
  } finally {
    await adminPool.end();
  }
  throw new Error('No Google API key: pass --key, set GOOGLE_TRANSLATE_API_KEY, or set the Google key under System Configuration → API Keys.');
}

// ─── Protecting what must not change ─────────────────────────────────────────

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeHtml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace fill-ins, numbered tags and kept words with markers Google leaves alone. */
function protect(text: string, keep: string[]): { html: string; pieces: string[] } {
  const pieces: string[] = [];
  const patterns = [/\{\{\s*[\w.-]+\s*\}\}/g, /<\/?\d+\s*\/?>/g, ...keep.map((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, 'g'))];
  let marked = text;
  for (const p of patterns) {
    marked = marked.replace(p, (m) => { pieces.push(m); return `\u0000${pieces.length - 1}\u0000`; });
  }
  const html = escapeHtml(marked).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<span translate="no">§${i}§</span>`);
  return { html, pieces };
}

function restore(html: string, pieces: string[]): string {
  const text = html
    .replace(/<span[^>]*>\s*§\s*(\d+)\s*§\s*<\/span>/g, (_m, i: string) => `\u0000${i}\u0000`)
    .replace(/§\s*(\d+)\s*§/g, (_m, i: string) => `\u0000${i}\u0000`);
  return decodeHtml(text)
    // Google tends to leave a space between a protected piece and the punctuation after it.
    .replace(/\u0000(\d+)\u0000\s+(?=[.,;:!?)\]”»"'])/g, '\u0000$1\u0000')
    // …and between opening punctuation and a protected piece: "( {{unit}})", "“ {{value}} ”".
    .replace(/([(\[“«"'¿¡])\s+(?=\u0000\d+\u0000)/g, '$1')
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => pieces[Number(i)] ?? '');
}

// ─── "tú", not "usted" (requirement 6.7) ─────────────────────────────────────

/**
 * Google mixes the informal "tú" and the formal "usted". A phrase is listed for review when it has
 * "usted" or a common formal command ("Utilice", "Marque", "Introduzca"…) at the start of a sentence;
 * the "tú" forms are "Usa", "Marca", "Introduce".
 */
const FORMAL_COMMANDS = [
  'Utilice', 'Use', 'Marque', 'Seleccione', 'Introduzca', 'Ingrese', 'Haga', 'Pulse', 'Escriba', 'Elija',
  'Compruebe', 'Revise', 'Añada', 'Agregue', 'Intente', 'Vuelva', 'Espere', 'Póngase', 'Contacte', 'Consulte',
  'Asegúrese', 'Indique', 'Guarde', 'Abra', 'Suba', 'Cargue', 'Elimine', 'Edite', 'Cambie', 'Confirme',
  'Acepte', 'Envíe', 'Inicie', 'Cierre', 'Complete', 'Rellene', 'Permita', 'Active', 'Desactive', 'Añádalo',
];
const FORMAL = new RegExp(`\\b(usted|ustedes)\\b|(^|[.!?¿¡:]\\s*)(${FORMAL_COMMANDS.join('|')})\\b`, 'i');
/** Formal forms that also appear in the middle of a sentence ("o añada", "¿Desea…?", "lo que introduzca"). */
const FORMAL_MID = /\b(añada|guarde|deje|arrastre|haga clic|vuelva a|verifique|realice|desea|désela|prefiera|introduzca|seleccione|elija|compruebe|inténtelo|póngase|tenga en cuenta|puede revocar|duplique|corrija|configure|utilice|ejecute|elimínela|elimínelo)\b/i;
function formalSpanish(text: string): boolean {
  return FORMAL.test(text) || FORMAL_MID.test(text);
}

// ─── Google Cloud Translation (Basic, v2) ────────────────────────────────────

async function translateBatch(key: string, target: string, html: string[]): Promise<string[]> {
  const send = async () => {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: html, source: DEFAULT_LANGUAGE, target, format: 'html' }),
    });
    const body = await res.json() as { data?: { translations?: { translatedText: string }[] }; error?: { message?: string } };
    if (!res.ok || !body.data?.translations) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    return body.data.translations.map((t) => t.translatedText);
  };
  try { return await send(); } catch { return await send(); }   // one retry
}

// ─── Files ───────────────────────────────────────────────────────────────────

const readBundle = (file: string): TranslationBundle =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as TranslationBundle : {};

/** Write keys in the English file's order; keys English no longer has are kept at the end. */
function writeBundle(file: string, needed: Map<string, string>, bundle: TranslationBundle): void {
  const ordered: TranslationBundle = {};
  for (const key of needed.keys()) if (bundle[key] !== undefined) ordered[key] = bundle[key];
  for (const key of Object.keys(bundle)) if (ordered[key] === undefined) ordered[key] = bundle[key];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
}

// ─── Run ─────────────────────────────────────────────────────────────────────

interface Job { file: string; key: string; english: string; html: string; pieces: string[] }

async function main(): Promise<void> {
  const glossary = (fs.existsSync(GLOSSARY_FILE) ? JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8')) : { keep: [], fixed: {} }) as Glossary;
  let key: string | null = null;
  let totalChars = 0;
  const failures: string[] = [];
  const review: string[] = [];

  // --review: list existing translations to correct (formal forms, spaces next to fill-ins); sends nothing.
  if (flag('review')) {
    for (const target of targets) {
      for (const root of LOCALE_ROOTS) {
        const dir = path.join(root, target);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
          const label = path.relative(ROOT, path.join(dir, name)).replace(/\\/g, '/');
          for (const [k, v] of Object.entries(readBundle(path.join(dir, name)))) {
            if (target === 'es' && formalSpanish(v)) review.push(`${label} ${k}: formal ("usted") form: ${v}`);
            if (/[(\[“«¿¡]\s+\{\{|\}\}\s+[.,;:!?)\]”»]/.test(v)) review.push(`${label} ${k}: space next to a fill-in: ${v}`);
          }
        }
      }
    }
    console.log(review.length ? `To review (${review.length}):` : 'Nothing to review.');
    review.forEach((r) => console.log(`  ${r}`));
    return;
  }

  for (const target of targets) {
    const locale = languageLocale(target);
    const fixed = glossary.fixed[target] ?? {};
    console.log(`\n${target} (${locale})`);
    for (const root of LOCALE_ROOTS) {
      const enDir = path.join(root, DEFAULT_LANGUAGE);
      if (!fs.existsSync(enDir)) continue;
      for (const name of fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort()) {
        const english = readBundle(path.join(enDir, name));
        const file = path.join(root, target, name);
        const bundle = readBundle(file);
        const needed = neededKeys(english, locale);
        const jobs: Job[] = [];
        let fixedCount = 0;
        for (const [k, source] of needed) {
          if (bundle[k] !== undefined && bundle[k] !== '') continue;
          const text = english[source];
          if (typeof text !== 'string' || !text.trim()) continue;
          if (fixed[text] !== undefined) { bundle[k] = fixed[text]; fixedCount++; continue; }
          const { html, pieces } = protect(text, glossary.keep);
          jobs.push({ file, key: k, english: text, html, pieces });
        }
        const chars = jobs.reduce((n, j) => n + j.html.length, 0);
        const label = path.relative(ROOT, file).replace(/\\/g, '/');
        if (jobs.length === 0 && fixedCount === 0) continue;
        if (dryRun) { totalChars += chars; console.log(`  ${label}: ${jobs.length} to send (${chars} characters), ${fixedCount} from the glossary`); continue; }

        key ??= await apiKey();
        let done = 0;
        let sent = 0;
        for (let i = 0; i < jobs.length;) {
          const batch: Job[] = [];
          let size = 0;
          while (i < jobs.length && batch.length < BATCH_PHRASES && (batch.length === 0 || size + jobs[i].html.length <= BATCH_CHARS)) {
            size += jobs[i].html.length; batch.push(jobs[i]); i++;
          }
          try {
            const out = await translateBatch(key, target, batch.map((j) => j.html));
            sent += size;
            batch.forEach((j, n) => {
              const value = restore(out[n], j.pieces).trim();
              if (placeholdersOf(value).join('|') !== placeholdersOf(j.english).join('|')) {
                failures.push(`${label} ${j.key}: lost a fill-in ("${value}"); left untranslated`);
                return;
              }
              bundle[j.key] = value;
              done++;
              if (target === 'es' && formalSpanish(value)) review.push(`${label} ${j.key}: formal ("usted") form: ${value}`);
            });
          } catch (e) {
            failures.push(`${label}: a batch of ${batch.length} failed (${(e as Error).message})`);
          }
        }
        writeBundle(file, needed, bundle);
        totalChars += sent;
        console.log(`  ${label}: ${done} translated (${sent} characters), ${fixedCount} from the glossary`);
      }
    }
  }

  console.log(`\nCharacters ${dryRun ? 'to send' : 'sent'}: ${totalChars}`);
  if (review.length) { console.log(`\nTo review (${review.length}):`); review.forEach((r) => console.log(`  ${r}`)); }
  if (failures.length) { console.log(`\nNot translated (${failures.length}):`); failures.forEach((f) => console.log(`  ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
