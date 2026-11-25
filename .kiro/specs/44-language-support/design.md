# Phase 44: Language Support - Design Document

**Date**: November 24, 2026
**Status**: ✅ Complete
**Dependencies**: Phase 03, Phase 04, Phase 51

---

## Overview

The web app keeps the i18next library it already has. Every piece of text on a tenant, business or customer screen comes from a translation file, by a key; English files are written by hand, and the files of other languages are filled by a command that calls Google Cloud Translation. The server answers in the language the browser is showing, and writes emails and PDFs in the customer's (or staff member's) language. Checks run with the tests: they report untranslated phrases, and fail on broken fill-in values and on text typed straight into a screen.

The requirement numbers below (R1.4 and so on) refer to requirements.md.

---

## Table of Contents

1. [Languages and Codes](#1-languages-and-codes)
2. [The User's Saved Language](#2-the-users-saved-language)
3. [Choosing the Language in the Browser](#3-choosing-the-language-in-the-browser)
4. [Translation Files and Keys](#4-translation-files-and-keys)
5. [Dates, Times and Numbers](#5-dates-times-and-numbers)
6. [Server Messages](#6-server-messages)
7. [Emails and Documents](#7-emails-and-documents)
8. [The Translation Command](#8-the-translation-command)
9. [The Checks](#9-the-checks)
10. [Conversion Order](#10-conversion-order)
11. [Adding a Language](#11-adding-a-language)
12. [Decisions](#12-decisions)
13. [The Business's Languages](#13-the-businesss-languages)
14. [Translating Offerings](#14-translating-offerings)

---

## 1. Languages and Codes

One list in `packages/shared/src/constants/supported.ts` says which languages exist, and every language choice reads it: the menu bar, the customer record, document template, form and Check-In wording languages, the customer import, the server's validation, and the translation command and checks (R1.4; owner, 24 Nov 2026). A language is added to it when work on it starts. Records keep two-letter codes (`en`, `es`); the formatting locale is derived from the code.

```ts
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export const TRANSLATED_LANGUAGES = SUPPORTED_LANGUAGES;   // the same list, the name the translation command uses

export const LANGUAGE_DETAILS: Record<SupportedLanguage, { label: string; locale: string; aliases: readonly string[] }> = {
  en: { label: 'English', locale: 'en-US', aliases: ['english', 'inglés', 'ingles'] },
  es: { label: 'Español', locale: 'es-ES', aliases: ['spanish', 'español', 'espanol', 'castellano'] },
};
```

- `label` is the language's own name, shown in every language choice (R1.5).
- `locale` is the language's default format, used when the device's regional setting is for another language, and for emails and documents (R1.3, R4.4).

Regional variants are already handled by `languageFromText` (`es-MX` → `es`), which the browser detection uses (R2.4).

---

## 2. The User's Saved Language

### 2.1 Database

Migration `200_user_preferred_language.sql`:

```sql
ALTER TABLE usr_users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10);   -- NULL = not chosen; use the device's language
```

No default: a NULL is what lets the device's language apply (R2.2). `usr_users` already has `tenant_id` and its RLS policy. The value is validated against `SUPPORTED_LANGUAGES` on write, not by a CHECK constraint, so adding a language needs no migration.

### 2.2 API

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `PUT` | `/api/v1/profile/language` | `{ language: string }` | Authenticated; any persona except `system` (403); a language not offered is refused (400); saves `preferred_language` for the signed-in user; for a customer also their customer record in the business given by `business_id` |

- The profile routes already hold each person's own settings, so the endpoint is there rather than under `/auth`.
- The login response and `GET /api/v1/profile` (read at start-up) add `preferred_language` to the user, and `User` in `AuthContext.tsx` gets `preferred_language?: string | null`.
- The language is not put in the JWT, so changing it needs no new token.

### 2.3 Customers

A customer's emails follow `cus_customers.preferred_language` (R5.1), which staff set on the customer record. When a signed-in customer picks a language in the menu bar, the same request also sets `preferred_language` on their customer record in the active business, so their screens and their emails agree (R2.9, agreed with the owner).

---

## 3. Choosing the Language in the Browser

### 3.1 Order

`packages/client/src/i18n/index.ts` decides the language at start-up and again whenever the signed-in user or persona changes:

```
persona is 'system'              → 'en'                                     (R2.10)
signed in, preferred_language set → preferred_language                     (R2.1)
choice remembered on the device   → that choice                             (R2.7, before sign-in)
browser's languages               → first one languageFromText() supports   (R2.2, R2.4; navigator.languages in order)
otherwise                         → 'en'                                    (R2.3)
```

A small `LanguageSync` component inside the auth and context providers applies this order when the user or persona changes, by calling `i18n.changeLanguage`. Changing the language re-renders the text in place, so the page is not reloaded and form state is kept (R2.8).

### 3.2 The menu bar choice

`LanguageSwitcher` (in `AppShell` and on the public pages' header):

- Lists `LANGUAGE_OPTIONS` with their own names (R1.5); hidden when only one language is supported, and hidden for the System persona (R2.10).
- On change: show the language, remember it on the device (`localStorage.language`, as today), and, when signed in, `PUT /profile/language` (R2.6).
- A choice made while signed out is marked unsaved (`localStorage.language_unsaved`). At sign-in, an unsaved choice that differs from the account's is saved to the account and shown (R2.7); the mark is then cleared. The account's language comes before the device's in the order, so it wins on later visits.

### 3.3 The System persona

The persona, not the active context, decides: a system administrator viewing a business still gets English and no language menu (R2.10). Shared components therefore show English on system screens with no special handling, because the whole app is in English for that user (R3.4, R3.7).

### 3.4 Loading languages

English is bundled. Other languages are loaded when first needed, with Vite's `import.meta.glob('./locales/*/*.json')` and `i18n.addResourceBundle`, so English users never download Spanish. A phrase missing in Spanish falls back to English (`fallbackLng: 'en'`, R1.6).

The `<html lang>` attribute follows the language shown, so screen readers pronounce it correctly.

---

## 4. Translation Files and Keys

### 4.1 Where the files are

```
packages/client/src/i18n/locales/en/<namespace>.json     ← written by hand, the source (R1.2)
packages/client/src/i18n/locales/es/<namespace>.json     ← filled by the translation command
packages/server/src/i18n/locales/en/<namespace>.json
packages/server/src/i18n/locales/es/<namespace>.json
```

The existing `common`, `auth` and `errors` files are kept and extended.

### 4.2 Namespaces

One namespace per area, matching the sidebar modules, so a file stays a manageable size and loads with its screens:

`common` (shared words and the design-system components), `auth`, `nav` (sidebar, module names, menu bar, context switcher, dashboard tiles), `shell` (unsaved-changes prompts, the error screen, loading), `bookings`, `calendar`, `checkout`, `customers`, `services`, `staff`, `payments`, `marketing`, `events`, `memberships`, `inventory`, `reports`, `settings`, `templates`, `forms`, `checkin`, `widget` (booking widget), `portal` (customer pages), `tenant`, `errors`, and on the server `errors`, `email`, `pdf`.

### 4.3 Keys and phrases

- Keys are flat dot paths, as in Goldmine: `bookings.list.empty`, `common.save`.
- Fill-ins use i18next's `{{name}}`: `"bookings.cancel.confirm": "Cancel {{customer}}'s appointment?"`.
- Counts use i18next plurals: `bookings.count_one` / `bookings.count_other`, with `t('bookings.count', { count })`. Spanish has the same two forms.
- Text with a link or bold part uses `<Trans>` with named tags, so the whole sentence is translated together rather than in pieces.
- Sentence case and the style guide's wording rules apply to the English files.

### 4.4 Screens

```tsx
const { t } = useTranslation('bookings');
<Button onClick={save}>{t('common:save')}</Button>
<label htmlFor="notes">{t('form.notes')}</label>
<input placeholder={t('form.notesPlaceholder')} aria-label={t('form.notes')} />
```

Outside React (for example `moduleRegistry.ts`, column definitions, validation helpers) code stores the key, and the component that shows it calls `t`. Labels that come from the shared package (document types and their placeholders in `packages/shared/src/documents/catalog.ts`, Check-In wording names) are translated in the client by key (`templates:types.<key>`), and the shared English labels stay as the fallback.

### 4.5 Dialogs

The browser's `alert`, `confirm` and `prompt` show a title ("localhost:4000 says") and buttons in the browser's language, outside the design system, so they are not used (R3.8). `design-system/components/feedback/dialogs.ts` offers the same three as promises, shown by one `DialogHost` (mounted at the app's root) with the design system's Modal:

```ts
await askConfirm({ message: t('customers:archive.confirm'), confirmLabel: t('common:archive'), destructive: true });  // true | false
await showMessage({ message: t('...'), tone: 'error' });                                                         // OK
await askText({ message: t('...'), label: t('...'), defaultValue: '' });                                          // string | null
```

Titles and buttons default to translated words (`common:dialog.*`). The check (section 9.3) fails on any call to the browser's dialogs.

### 4.6 What is not translated

Values from the database that a business or customer typed (R3.6) are shown as they are. Fixed values the system stores, such as statuses (`confirmed`, `no_show`) and payment methods, are shown through a key (`bookings:status.no_show`), never by printing the stored value.

---

## 5. Dates, Times and Numbers

A new module `packages/client/src/utils/format.ts` is the only place that formats for display:

```ts
formatDate(value, options?)            // Intl.DateTimeFormat(currentLocale(), options)
formatTime(value, timeZone)            // business time zone kept (R4.3)
formatDateTime(value, timeZone, options?)
formatNumber(value, options?)
formatPercent(value)
formatMoney(cents, currency)           // Intl.NumberFormat(currentLocale(), { style: 'currency', currency })  (R4.2)
```

`currentLocale()` is the device's regional setting (`navigator.languages`, first entry) when its language is the language being shown, so an English user in the UK gets `en-GB` and one in the US `en-US`; otherwise it is `LANGUAGE_DETAILS[i18n.language].locale` (R1.3). A Spanish device showing English therefore writes English month names in US order, never Spanish month names on an English screen. The 170 places that call `toLocaleString`, `toLocaleDateString` or `Intl` directly move to these helpers as their screens are converted, including the 14 fixed to `'en-US'`. The server has no device to read, so emails and documents use `LANGUAGE_DETAILS[language].locale` of the recipient's language (R4.4).

`CurrencyInput` keeps storing cents (Critical Rule 7) and shows the decimal separator of the current locale.

Direct-debit mandate text (`checkout:stripe.sepaMandate`, `checkout:stripe.achMandate`) names the creditor through `{{creditor}}`. `beginCaptureSession` returns `creditorName` for bank debits: the Stripe account's `business_profile.name` (read with `accounts.retrieveCurrent`, kept for one hour per connection owner), else the name of the business or tenant that owns the connection. When neither exists the screen uses `common:app_name`.

---

## 6. Server Messages

### 6.1 The request's language

- `apiClient` (and the widget's client) sends `Accept-Language: <language shown>` on every request; for the System persona that is `en`.
- A new middleware `requestLanguage` reads it with `languageFromText`, falls back to `en`, and keeps it for the rest of the request in an `AsyncLocalStorage` store. It is registered before the routes in `routes/index.ts`.

### 6.2 Writing a message

```ts
// packages/server/src/i18n/index.ts
export function msg(key: string, params?: Record<string, string | number>): string;           // the request's language
export function msgIn(language: string | null, key: string, params?: Record<string, string | number>): string;  // a given language
```

Services replace English literals with keys, and keep their error classes:

```ts
throw new BookingRuleError(msg('errors:booking.slotTaken', { time }));
```

Because `msg` renders in the request's language at the moment the error is made, the routes that already answer `res.status(400).json({ error: err.message })` need no change (R3.5). With no request (background jobs) the language is English. The existing `getLocalizedMessage` and its 11 messages move into `errors.json`.

### 6.2a Recognising a message

Some routes recognised an error by its English text (`err.message === 'Invalid credentials'`, `err.message.includes('not found')` to answer 404). Messages are no longer always English, so these use `isMessage(text, 'errors:…')` (the text is that message, in the request's language or English, whatever its fill-ins) and `messageHas(text, 'not found')` (the text is any message whose English contains the phrase, or contains it itself, as database errors do).

### 6.3 Validation

Request validation (`validate(schema)`, Joi) keeps Joi's own English wording, as today, and for another language builds its messages from each Joi error's type and field (`details[].type`, `details[].context.label`) through `msg('errors:validation.<type>', { field })`, so the schemas need no per-field text. Field names in those messages come from the `errors` namespace (`errors:fields.<name>`), falling back to the field's name.

### 6.4 Scope

About 500 messages are thrown from services and about a dozen written directly in routes. Messages from routes that only the System persona uses (`system-config.ts`, the platform administration routes) stay English (R3.7) and are on the English-only list (section 9.3).

---

## 7. Emails and Documents

### 7.1 Which language

| Recipient | Language |
|-----------|----------|
| Customer | `cus_customers.preferred_language` (R5.1) |
| Staff member | `usr_users.preferred_language`, else English (R5.5) |

The language is looked up when the email is sent (`services/recipient-language.service.ts`: the customer record's language, else the staff member's account's), unless the notification carries `data.language`; every built-in phrase is rendered with `msgIn(language, …)`. Document PDFs take it from the customer of the invoice, credit or debit note, or receipt. Texts built when a notification is queued (the event emails' date, ticket and amount lines) are written in the customer's language at that point.

### 7.2 Choosing the template

`selectTemplate` in `document-branding-resolver.service.ts` changes its order to (R5.2, R5.3):

```
1. the business's active template in the recipient's language
2. the business's active English template, or one with no language set
3. the active system template in the recipient's language
4. the active system template in English, or with no language set
5. the plain email (built-in wording, in the recipient's language)
```

Today step 2 is "any template with no language"; it now also takes an English one, so a business that labelled its template English is not skipped.

### 7.3 Built-in wording

Moved into the server's `email` and `pdf` namespaces and rendered in the recipient's language (R5.4):

- the plain email used when no template applies (greeting, appointment details, links, footer);
- receipt, invoice, credit and debit note PDF labels (Subtotal, Tax, Total, Paid, Due);
- completed-form PDFs' headings, the signature block and the "I agree" line;
- the dates, times and amounts inside them (section 5).

The Check-In wording already has a version per language with built-in defaults in `packages/shared/src/checkin/text.ts`; Spanish defaults are added there (the type requires an entry for every supported language).

---

## 8. The Translation Command

### 8.1 Running it

```
npm run translate                 # every language in TRANSLATED_LANGUAGES except English, client and server files
npm run translate -- --lang es    # one language
npm run translate -- --dry-run    # report what would be sent and the character count, send nothing
```

`scripts/translate.ts` in `packages/server` (run with `tsx`, so it can read the database), registered as a root script.

### 8.2 The key

Taken from, in order (R6.2):
1. `--key <value>`;
2. `GOOGLE_TRANSLATE_API_KEY` in the environment;
3. the platform's key in `sys_system_configurations` (`category = 'api_keys'`, `config_data.google_places`), read from the database in `DATABASE_URL` (the development database when run locally).

The key is never written to a file or printed.

### 8.3 What it does

For each namespace file and target language:

1. Reads the English and target files; the phrases to send are the English keys missing from the target (R6.1, R6.3). Existing translations are never sent or changed.
2. Protects what must not change by wrapping it in `<span translate="no">…</span>` and sending with `format: 'html'`: fill-ins (`{{name}}`), `<Trans>` tags (`<1>…</1>`), and the do-not-translate terms in `packages/server/scripts/i18n-glossary.json` (DayStream, product terms the owner wants kept). The wrappers are removed from the result and HTML entities decoded (R6.4).
3. Applies the glossary's fixed translations for whole phrases or words that must always read the same way (for example Check-In → "Registro", Booking → "Reserva", Appointment → "Cita"), so terms stay consistent across screens.
4. Calls Cloud Translation Basic (v2):
   ```
   POST https://translation.googleapis.com/language/translate/v2?key=…
   { "q": [ …up to 100 phrases… ], "source": "en", "target": "es", "format": "html" }
   ```
   in batches of up to 100 phrases, retrying a failed batch once.
5. Writes the target file with keys in the same order as the English file, as UTF-8 without a byte-order mark.
6. Reports per file: phrases translated, characters sent, phrases that failed, and any translation that contains "usted"/"ustedes" or lost a fill-in, for a person to correct (R6.5, R6.7).

Google's service has no setting for "tú" or "usted"; its output for interface text in Spain mostly uses "tú", and the report lists the exceptions. A corrected phrase is kept by later runs (R6.3).

### 8.4 Cost

Only missing phrases are sent. The first full run for Spanish is estimated at 150,000 to 250,000 characters, within the 500,000 free each month; later runs send only new phrases. `--dry-run` shows the count before sending.

---

## 9. The Checks

A test file per package, `i18n.check.test.ts`, run with `npm run test` (R7.4).

### 9.1 Missing translations (reported, not failed)

For every language in `TRANSLATED_LANGUAGES`, the English keys with no translation are listed in the test output and written to `i18n-missing.<lang>.txt` (not committed) (R7.1). The test passes.

### 9.2 Fill-ins (failed)

For every translated phrase, the set of `{{…}}` fill-ins and `<n>` tags must equal the English phrase's; plural forms must exist for every plural key. A difference fails the test, naming the file and key (R7.2).

### 9.3 Text typed into screens (failed)

A scanner using the TypeScript compiler API (already a dependency) reads every `.ts` and `.tsx` file under `packages/client/src` and fails on:
- JSX text containing letters (`<p>Save changes</p>`);
- string literals in the attributes `placeholder`, `title`, `alt`, `aria-label`, `label`, `helper`, `emptyMessage`, `confirmText` and the like;
- string literals in object properties with those names and `text`, `header` and the like (menu items, columns, options, steps);
- string literals passed to `alert`, `confirm` and `prompt`.

Translation keys (`table.noRows`, `nav:modules.customers.title`), CSS variables and web addresses are not text.

The same scanner reads server services and routes for string literals passed to `new …Error(…)` and to `json({ error: … })` (R7.3).

Two lists in `packages/client/src/i18n/scope.json` (and the server's equivalent) control which files are checked:
- **English only**: files used only by the System persona (the `/admin` pages and routes that only `system` may open, such as AdminConfig, Tenants, SystemReports and AuditLog). Never checked (R3.7).
- **Not converted yet**: every other file that still has typed text when the check is introduced. A file on this list is skipped. The list only gets shorter: the check fails when a file on it no longer has typed text (it must be removed), and a file not on it is checked, so every new screen is held to the check from the start. Adding a file to the list by hand is a review matter; the list is generated once, when the check is introduced (`I18N_WRITE_SCOPE=1`).

Allowed without a key: text without a word of two letters or more (punctuation, numbers, symbols, single letters), and strings marked with a `// i18n-ignore` comment on their line or the line above (for example a code sample).

---

## 10. Conversion Order

Each stage leaves the app working; untranslated screens show English.

1. **Foundation**: language codes and locales (section 1), migration 200 and the language API, the language order and `LanguageSync`, the switcher, `Accept-Language` and `requestLanguage`, `msg`/`msgIn`, the format helpers, the translation command, the checks with both lists filled in.
2. **Shared parts**: the design-system components, `AppShell`, the menu bar, the sidebar (`moduleRegistry`), the context switcher, common dialogs.
3. **Public and customer pages**: sign-in, password reset, the booking widget, self check-in (kiosk, QR and phone link), public forms, receipts and the customer's pages.
4. **Business screens**, area by area in sidebar order: Dashboard, Bookings and Calendar, Checkout and Orders, Customers, Services and Offerings, Staff, Payments, Marketing, Events, Memberships and Packages, Inventory, Reports, Business Setup and Settings, Templates.
5. **Tenant screens**: tenant dashboard, businesses, users, settings, billing, reports and processes.
6. **Server messages**: services and routes, area by area, matching stage 4's order; validation messages.
7. **Emails and documents**: template order (7.2), built-in wording, PDF labels, staff emails, Check-In defaults.
8. **Translate and review**: run the command for Spanish, correct the reported phrases, check the glossary terms on screen.

---

## 11. Adding a Language

A language is added by putting its code on the list and its entry in `LANGUAGE_DETAILS` (section 1), then running the translation command. It is offered everywhere from then on; phrases not yet translated show in English (R1.4, R1.6). Spanish was added this way.

---

## 12. Decisions

1. **Formats** (owner, 24 Nov 2026): dates and numbers follow the device's regional settings for the language shown (section 5).
2. **A customer's own choice** (owner, 24 Nov 2026): it also sets the language on their customer record (section 2.3).

---

## 13. The Business's Languages

Requirement 8.

### 13.1 Storage

Migration `201_business_languages_and_translations.sql`:

```sql
ALTER TABLE sys_businesses ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}';
-- Existing businesses: every language on the list when the setting is introduced (R8.4).
UPDATE sys_businesses SET languages = ARRAY['en', 'es'];
```

The business's languages are its `default_language` plus `languages`, kept to DayStream's list and in list order (`businessLanguages()` in the shared package). A new business gets `'{}'`, that is its default language only. A language DayStream adds later is in no business's `languages` until the business ticks it.

### 13.2 API

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| `GET` | `/api/v1/admin/businesses/:id/languages` | `settings:read` | `{ default_language, languages }` (the full set, default first) |
| `PUT` | `/api/v1/admin/businesses/:id/languages` | `settings:*` | `{ languages }`; languages not on the list are refused; the default is always kept |

The booking widget's start-up data and the public check-in and form pages also return the business's languages, so their language menu offers only those.

### 13.3 Screens

- Business Settings → General: a Languages section, a checkbox per language on the list in its own name; the default language ticked and locked.
- `LanguageSelect` takes the list to offer. The customer record, document templates, forms and Check-In wording pass the business's languages (`useBusinessLanguages()`); the menu bar passes the business's languages while someone works in a business, and the full list at tenant and System level (R8.3). `LanguageSync` resolves the language within the offered list (`resolveLanguage({ …, offered })`): a saved choice the business does not offer is passed over but kept, and with none left the business's default language is shown.
- `PublicLanguageBar` takes the business's languages on the public pages.

## 14. Translating Offerings

Requirement 9.

### 14.1 What is translated

One map in the shared package (`TRANSLATABLE_FIELDS`), used by the server and the screens:

| Entity | Table | Fields |
|--------|-------|--------|
| `service` | `svc_services` | name, short_description, description |
| `product` | `prd_merchandise` | name, short_description, description |
| `membership` | `mbr_plans` | name, short_description, description |
| `package` | `pkg_packages` | name, short_description, description |
| `service_option` | `svc_variants` | name |
| `addon` | `svc_addons` | name, description |

### 14.2 Storage

Same migration 201:

```sql
CREATE TABLE IF NOT EXISTS cat_translations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  business_id   UUID NOT NULL,
  entity_type   VARCHAR(20) NOT NULL CHECK (entity_type IN ('service','product','membership','package','service_option','addon')),
  entity_id     UUID NOT NULL,
  language      VARCHAR(10) NOT NULL,
  fields        JSONB NOT NULL DEFAULT '{}',   -- { name, short_description, description }
  source        JSONB NOT NULL DEFAULT '{}',   -- the default-language text the translation was made from
  translated_by VARCHAR(10) NOT NULL DEFAULT 'person' CHECK (translated_by IN ('machine','person')),
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, language)
);
-- RLS on tenant_id, as every business table.
```

A translation is out of date (R9.4) when its `source` differs from the record's current default-language text.

### 14.3 API

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| `GET` | `/api/v1/translations/:entityType/:entityId` | `services:read` | the default-language text and language, the business's other languages, and each one's translation, out-of-date flag and who made it |
| `PUT` | `/api/v1/translations/:entityType/:entityId/:language` | `services:*` | `{ fields, translated_by }`; saves the row and its `source` |
| `POST` | `/api/v1/translations/:entityType/:entityId/:language/translate` | `services:*` | Google's translation of the default-language text into the language; not saved (the business reviews, then saves) |

`business_id` is required and the record must belong to the business. The machine translation (`services/machine-translation.service.ts`) uses Cloud Translation Basic with the platform's Google key (as the translation command), fill-ins protected; a refusal at the daily limit is shown as a message.

### 14.4 Showing translations to customers

`localizeOfferings(entityType, rows, language)` in `services/offering-translations.service.ts` replaces the fields with the translation in a language, keeping the default-language text where there is none. It is applied:
- in the booking widget's lists and details (services, options, add-ons, products, packages, memberships), in the request's language;
- in the customer's pages, in the request's language;
- in customer emails and documents: the service, option, add-on, product, package and membership names in the queued data are replaced with the customer's language's translation when the email is sent (R9.5).

### 14.5 Screens

A `TranslationsTable` component, opened by the record's Translate button in a large dialog:
- rows: the default language first (its text, read only), then each of the business's other languages with an input per field (descriptions as text areas), a Translate button, and "Out of date" when the default-language text changed since (whether a row is empty, from Google or edited is plain to see, so it is not labelled; owner, 24 Nov 2026);
- Translate fills the row (asking first when it has text); Save saves the changed rows.

The service, product, membership and package screens open it for the record; the Options and Add-ons sections of a service open it per option and per add-on.

---

**Last Updated**: November 25, 2026
