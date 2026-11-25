import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { DEFAULT_LANGUAGE, languageFromText, languageLocale } from '@daystream/shared';

/**
 * The server's messages in the user's language (Phase 44, design section 6).
 *
 * Translation files: locales/<language>/<namespace>.json, flat keys ("booking.slotTaken"), fill-ins as
 * {{name}}, plurals as key_one / key_other with a `count` fill-in. English is the source; a key with no
 * translation falls back to English, and a key with no English either is returned as it is.
 *
 *   msg('errors:booking.slotTaken', { time })      → in the request's language (the browser's Accept-Language)
 *   msgIn('es', 'email:greeting', { name })        → in a given language (emails, documents)
 *
 * Outside a request (background jobs) msg() writes English.
 */

type Bundle = Record<string, string>;
const LOCALES_DIR = path.join(__dirname, 'locales');

/** language → namespace → bundle, read once at start-up. */
const bundles: Record<string, Record<string, Bundle>> = {};
function loadAll(): void {
  if (!fs.existsSync(LOCALES_DIR)) return;
  for (const language of fs.readdirSync(LOCALES_DIR)) {
    const dir = path.join(LOCALES_DIR, language);
    if (!fs.statSync(dir).isDirectory()) continue;
    bundles[language] = {};
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      bundles[language][file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Bundle;
    }
  }
}
loadAll();

export type MessageParams = Record<string, string | number | null | undefined>;

const store = new AsyncLocalStorage<{ language: string }>();

/** The language of the current request (English outside a request). */
export function requestLanguageCode(): string {
  return store.getStore()?.language ?? DEFAULT_LANGUAGE;
}

/** Read the language the browser is showing from Accept-Language; English when none is offered. */
export function languageFromHeader(header: string | undefined): string {
  if (!header) return DEFAULT_LANGUAGE;
  for (const part of header.split(',')) {
    const lang = languageFromText(part.split(';')[0]);
    if (lang) return lang;
  }
  return DEFAULT_LANGUAGE;
}

/** Express middleware: keeps the request's language for msg() for the rest of the request. */
export function requestLanguage(req: Request, _res: Response, next: NextFunction): void {
  store.run({ language: languageFromHeader(req.headers['accept-language']) }, () => next());
}

/** Run a function with msg() writing a given language (for example a job working for a customer). */
export function withLanguage<T>(language: string | null | undefined, fn: () => T): T {
  return store.run({ language: language || DEFAULT_LANGUAGE }, fn);
}

function split(key: string): [string, string] {
  const i = key.indexOf(':');
  return i === -1 ? ['errors', key] : [key.slice(0, i), key.slice(i + 1)];
}

function lookup(language: string, ns: string, key: string, count: number | undefined): string | undefined {
  const bundle = bundles[language]?.[ns];
  if (!bundle) return undefined;
  if (count !== undefined) {
    const form = new Intl.PluralRules(languageLocale(language)).select(count);
    const plural = bundle[`${key}_${form}`] ?? bundle[`${key}_other`];
    if (plural !== undefined) return plural;
  }
  return bundle[key];
}

function fill(text: string, params?: MessageParams): string {
  if (!params) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
    const v = params[name];
    return v === null || v === undefined ? whole : String(v);
  });
}

/** True when the key has an English phrase. */
export function hasMessage(key: string): boolean {
  const [ns, k] = split(key);
  return lookup(DEFAULT_LANGUAGE, ns, k, undefined) !== undefined || lookup(DEFAULT_LANGUAGE, ns, `${k}_other`, undefined) !== undefined;
}

/** A message in a given language; English when it has no translation; the key when it has no English. */
export function msgIn(language: string | null | undefined, key: string, params?: MessageParams): string {
  const [ns, k] = split(key);
  const count = typeof params?.count === 'number' ? params.count : undefined;
  const text = lookup(language || DEFAULT_LANGUAGE, ns, k, count) ?? lookup(DEFAULT_LANGUAGE, ns, k, count) ?? k;
  return fill(text, params);
}

/** A message in the request's language. */
export function msg(key: string, params?: MessageParams): string {
  return msgIn(requestLanguageCode(), key, params);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const keysWithPart = new Map<string, string[]>();

/**
 * True when a text is any server message whose English contains a phrase, in the request's language or
 * in English: for code that picks a status from the message (`messageHas(err.message, 'not found')`).
 * Text that is not one of our messages (a database error) is matched on the English phrase itself.
 */
export function messageHas(text: unknown, englishPart: string): boolean {
  if (typeof text !== 'string') return false;
  if (text.includes(englishPart)) return true;
  let keys = keysWithPart.get(englishPart);
  if (!keys) {
    const bundle = bundles[DEFAULT_LANGUAGE]?.errors ?? {};
    keys = Object.entries(bundle).filter(([, v]) => v.includes(englishPart)).map(([k]) => `errors:${k}`);
    keysWithPart.set(englishPart, keys);
  }
  return keys.length > 0 && isMessage(text, ...keys);
}

/**
 * True when a text is one of the given messages, in the request's language or in English, whatever
 * its fill-ins: for code that recognises an error by its message (`isMessage(err.message,
 * 'errors:bookings.bookingNotFound')`) now that messages are no longer always English.
 */
export function isMessage(text: unknown, ...keys: string[]): boolean {
  if (typeof text !== 'string') return false;
  const languages = new Set([requestLanguageCode(), DEFAULT_LANGUAGE]);
  for (const full of keys) {
    const [ns, key] = split(full);
    for (const language of languages) {
      for (const form of [key, `${key}_one`, `${key}_other`, `${key}_many`]) {
        const template = bundles[language]?.[ns]?.[form];
        if (template === undefined) continue;
        const pattern = template.split(/\{\{\s*\w+\s*\}\}/).map(escapeRegExp).join('[\\s\\S]*?');
        if (new RegExp(`^${pattern}$`).test(text)) return true;
      }
    }
  }
  return false;
}
