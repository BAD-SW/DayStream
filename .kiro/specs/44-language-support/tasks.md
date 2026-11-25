# Phase 44: Language Support - Tasks

## Overview

Requirements and design agreed with the owner, then the build in the order of design.md section 10. Each stage leaves the app working; untranslated text shows in English.

## Task Status Legend

- ✅ **Complete**: Task is finished and verified
- 🟡 **In Progress**: Task is currently being worked on
- 📋 **Planned**: Task is defined but not started
- ⏸️ **Blocked**: Task is waiting on dependencies
- ❌ **Cancelled**: Task is no longer needed

---

## 1. Requirements & Design

### 1.1 Discovery
- [x] ✅ Confirm current state in the code (24 Nov 2026)
- [x] ✅ Review the owner's Goldmine application's translation work (Google-translated files; no translation code to reuse; keep i18next)
- [x] ✅ Choose the translation approach: a developer script using Google Cloud Translation with the platform's Google API key; translations kept in files with the code
- [x] ✅ Define languages and formatting: English and Spanish (Spain); "tú" throughout
- [x] ✅ Agree requirements with the owner (24 Nov 2026)
- [x] ✅ Design (design.md), agreed with the owner (24 Nov 2026: formats follow the device's regional settings; a customer's choice also sets their customer record's language)

### 1.2 Owner set-up
- [x] ✅ Cloud Translation API switched on and allowed on the platform's Google key; daily cap "v2 and v3 general model characters per day" set to 200,000 (owner, 24 Nov 2026). Switch on the Cloud Translation API in the Google Cloud project of the platform's Places key (and allow it on the key if the key is restricted)

## 2. Foundation

### 2.1 Languages and the saved language
- [x] ✅ Language details with each language's default format; the one language list
- [x] ✅ Migration 200: usr_users.preferred_language
- [x] ✅ PUT /profile/language (not for the System persona); a customer's choice also sets their customer record's language; preferred_language in the login and profile responses

### 2.2 The browser
- [x] ✅ Language order (System persona, account, device choice, browser, English) and LanguageSync; html lang
- [x] ✅ Language switcher: own names, hidden for the System persona and when one language; saves to the account; a choice made before sign-in saved at sign-in
- [x] ✅ Language switcher on the public pages before sign-in (sign-in, password reset, personal data, booking widget, kiosk, phone check-in, public forms)
- [x] ✅ Languages other than English loaded when first needed; English for missing phrases
- [x] ✅ Format helpers (dates, times, numbers, money) with the device's regional settings

### 2.3 The server
- [x] ✅ Accept-Language sent by the API clients; requestLanguage middleware
- [x] ✅ msg and msgIn with server translation files; the existing localized messages moved into them
- [x] ✅ Validation messages built from the Joi error type and field

### 2.4 Translation command and checks
- [x] ✅ npm run translate (key order, protected fill-ins and terms, glossary, batches, report, dry run)
- [x] ✅ Checks: missing phrases and plural forms reported; fill-ins failed; typed text failed, with the English-only and not-converted-yet lists

## 3. Shared Parts
- [x] ✅ One language list for every language choice (menu bar, customer record, templates, forms, Check-In); Spanish on it from the start of the work, so no separate preview (owner, 24 Nov 2026)
- [x] ✅ Design-system components (common)
- [x] ✅ AppShell, AppLayout, AdminLayout, menu bar, sidebar and module names (moduleRegistry), dashboard tiles, context switcher, notifications, unsaved-changes prompts, error screen (nav, shell)
- [x] ✅ Check extended to .ts files and text in object properties (menu items, columns, options); query editor and the System report catalogue on the English-only list
- [x] ✅ Spanish translated and reviewed (338 phrases); review option (--review) for formal forms and spaces next to fill-ins; glossary terms added
- [x] ✅ Country names in the country picker in the language shown, sorted in that language (the browser's built-in names, Intl.DisplayNames); search matches the shown or English name, ignoring accents
- [x] ❌ Breadcrumb labels built from the address (only Home is translated): left out of this phase by the owner (24 Nov 2026)

## 4. Public and Customer Pages
- [x] ✅ Sign-in, password reset, personal data download and the profile (auth, account)
- [x] ✅ Booking widget, the booking flow and the booking parts it uses: day and slot pickers, add-ons, benefits, price summary, payment (widget, booking)
- [x] ✅ Self check-in (kiosk, QR, phone link) and public forms (checkin, forms); the business's own Check-In wording and form questions are shown as written
- [x] ✅ Receipts and the customer's pages: bookings, events, messages, community (portal)
- [x] ✅ Spanish translated and reviewed (621 phrases): formal "usted" wording changed to "tú"

## 5. Business Screens
- [x] ✅ Dashboard
- [x] ✅ Bookings and calendars
- [x] ✅ Checkout and orders
- [x] ✅ Customers
- [x] ✅ Services and offerings
- [x] ✅ Staff, schedules and payroll
- [x] ✅ Payments and accounting
- [x] ✅ Marketing and inbox
- [x] ✅ Events
- [x] ✅ Memberships, packages and gift cards
- [x] ✅ Inventory and purchase orders
- [x] ✅ Reports
- [x] ✅ Business Setup, Settings and Templates
- [x] ✅ Check that every key used in the code has an English phrase (else the screen would show the key)
- [x] ✅ Spanish translated (about 5,900 phrases, 142,055 characters) and reviewed: formal "usted" forms changed to "tú"; the review option also finds formal forms in the middle of sentences
- [x] ✅ SEPA mandate wording: the European Payments Council's approved English and Spanish authorisation and refund statements, adapted only for an online form (IBAN and confirmation instead of a signature) and to name Stripe as Stripe's own English text does
- [x] ✅ Mandate creditor taken from the Stripe account collecting the money (its public business name), else the business or tenant that owns the connection, else the application name; no longer hardcoded
- [x] ✅ ACH mandate: US scheme, English only from Stripe; the Spanish is our translation (accepted)
- [x] ✅ dayLabel in utils/zonedTime.ts uses the machine's format for the language shown (the calendar and New Appointment already used formatDay)

## 6. Tenant Screens
- [x] ✅ Tenant businesses, users, settings, billing, payment processors, reports, processes and prospects (tenant, tenantOps, prospects); the System-only components (Tenants page panels, territory, platform billing, prospect categories) on the English-only list
- [x] ✅ Spanish translated and reviewed (433 phrases); every client screen in scope converted (not-converted list empty)

## 7. Server Messages
- [x] ✅ Service and route messages (2,343 in 163 files) converted to msg('errors:…') with the English unchanged; the English-only list keeps the System routes
- [x] ✅ Code that recognised an error by its English text (90 places, such as the sign-in route) uses isMessage / messageHas, which work in every language
- [x] ✅ The browser's alert, confirm and prompt (177 uses) replaced by the application's dialogs (askConfirm, showMessage, askText) with translated titles, messages and buttons; check that fails on any browser dialog (owner, 24 Nov 2026)
- [x] ✅ Spanish translated and reviewed (1,597 server messages)
- [x] ❌ tests/customer-events.test.ts commission test compares a local date with the server's UTC date and fails in the evening; it failed before this phase, so it is not fixed here

## 8. Emails and Documents
- [x] ✅ Template order: recipient's language, then English (or no language), then the system template in each; a template in another language is never sent
- [x] ✅ The recipient's language looked up when an email is sent (none of the notifications carried it before); built-in email wording, the plain email, the reminder lead time, event email texts, receipt/invoice/credit/debit note PDF table labels and amounts in the recipient's language; staff emails in the staff member's language
- [x] ✅ Form PDFs: the Amendments heading added to their built-in wording (English, Spanish, French, German)
- [x] ✅ Spanish Check-In defaults (hand-written, "tú", gender-neutral)

## 9. The Business's Languages and Translating Offerings (owner, 24 Nov 2026)
- [x] ✅ Migration 201: business languages (existing businesses: English and Spanish) and cat_translations with RLS
- [x] ✅ Business languages setting (API; Business Settings → System → Languages) and the language choices narrowed to them: customer record, templates, forms, Check-In wording, public pages' language menu (booking widget, kiosk, phone check-in, public forms); System scope and the staff menu bar keep every language
- [x] ✅ Translations API (get, save, Google translation not saved until reviewed) and machine translation with the platform's Google key
- [x] ✅ Translate dialog: the default-language row read only, a row per other language with its own Translate button, and "Out of date" when the original changed; on services, products, memberships, packages, each service option and each add-on
- [x] ✅ Translations shown to customers: booking widget (lists and details, package and membership items), the customer's bookings list, email placeholders (service with add-ons, membership name)

## 10. Review and Close
- [x] ✅ Run the translation command for Spanish and correct the reported phrases (every phrase translated; review clean)
- [x] ✅ Spanish on the language list (one list, owner, 24 Nov 2026)
- [x] ✅ Verify live and close with the owner (closed 25 Nov 2026; closes Phase 51 gap 11)