# Phase 44: Language Support - Requirements

## Overview

DayStream's tenant, business and customer screens, the public pages, and everything the system sends to customers are offered in more than one language. Spanish (Spain) is the first language after English. The language shown is the user's own choice when they have made one, otherwise the device's language, otherwise English. Platform administration (the System persona) stays in English. Text that businesses or customers type themselves, such as service, product and package names, is shown as typed.

This phase also closes gap 11 of Phase 51 (Competitive Gaps).

**Agreed with the owner (24 Nov 2026)**:
- Spanish (Spain, es-ES) first.
- The System persona's screens stay in English.
- The language is the user's preference, else the device's language, else English; it is changed from the menu bar.
- Customers receive emails in the language on their customer account; with no template in that language, the English one is used.
- Translations are produced by a command a developer runs when text is added or changed, and are kept in files with the code; the application never calls the translation service while people use it (chosen over a System Configuration button, which would keep translations in the database where the checks cannot see them).
- Translations come from Google's translation service, called by DayStream itself with the Google API key the platform already holds for Places. (Goldmine's translations were produced outside the application, in a Kiro session, which spent Kiro credits on every translation; DayStream does not depend on that.)
- The languages offered are one fixed list in the code, used by every language choice (the menu bar, the customer record, document templates, forms and Check-In wording). A language is on the list from the moment work on it starts, even if not every phrase is translated yet; an untranslated phrase shows in English (owner, 24 Nov 2026: "We shouldn't have three different lists").
- A language picked before signing in is saved to the account at sign-in; emails to staff use the staff member's saved language.
- Dates and numbers follow the device's regional settings (for example UK or US English).
- A customer's language choice in the menu bar also sets the language on their customer record, so their emails match.
- The mobile app is not built yet; it, and every part built later, adds its language support as it is built.
- Customers and staff are addressed with the informal "tú" throughout (the owner has no preference; Goldmine uses "tú").

## Current State (confirmed in the code, 24 Nov 2026)

- The web app has the i18next library set up, with three small translation files (about 15 phrases each) in English and Spanish. No screen uses them: all screen text is written in the code (294 screen and component files, roughly 2,700 lines of text).
- The language shown is the one last chosen in the menu bar, else the browser's, else English. The choice is kept on the device only; the user account has no language.
- One shared list says which languages are supported (`packages/shared/src/constants/supported.ts`); it holds English only, so the menu bar offers English only. Spanish translations are loaded but switched off.
- The server has 11 translated error messages, used in 2 places; about 600 other messages are English text in the code.
- About 170 places format dates, times and amounts; 14 of them are fixed to US English.
- Email and document templates, forms and Check-In wording already have a version per language, picked by the customer's preferred language. When no template matches, a template with no language is used, then the system template. The built-in wording (the plain email, PDF labels) is English only.
- The owner's Goldmine application translates part of its screens with translation files produced outside the application; it has no code that calls a translation service, no check that every phrase is translated, and does not use the device's language.

## Goals

- Every tenant, business and customer screen, field and system message available in Spanish
- The right language shown without the user doing anything, and changed in one step
- Customers addressed in their own language in everything the system sends them
- New translations produced by a script rather than by hand, and missing ones reported

## Requirements

### Languages

#### Requirement 1: Languages Offered

**User Story**: As a business in Spain, I want DayStream in Spanish, so that my staff and customers can use it in their own language.

##### Acceptance Criteria

1. THE system SHALL offer English and Spanish (Spain).
2. THE system SHALL use English as the source language from which every other language is translated.
3. THE system SHALL format dates, times and numbers with the device's regional settings when they are for the language being shown (for example en-GB writes 24/11/2026 and en-US 11/24/2026), and otherwise with the language's own default (Spain for Spanish: "25 nov 2026, 9:00" and "1.234,50"; the United States for English).
4. THE system SHALL keep one list of languages in the code, SHALL offer that same list in every language choice (the menu bar, the customer record, document templates, forms and Check-In wording), and SHALL add a language to it from the moment work on the language starts, whether or not every phrase is translated.
5. THE system SHALL name each language in the menu bar in its own language (English, Español).
6. WHEN a phrase has no translation in the language being shown, THE system SHALL show it in English.

### Choosing the Language

#### Requirement 2: The Language Shown

**User Story**: As a user, I want DayStream to appear in my language without setting anything, and to change it in one step, so that I never have to search for a setting.

##### Acceptance Criteria

1. THE system SHALL show a signed-in user's screens in the language saved on their account.
2. WHEN a user has no saved language, THE system SHALL show the language of the device (the browser's language setting).
3. WHEN the device's language is not one the system offers, THE system SHALL show English.
4. THE system SHALL treat regional variants of a language as that language (for example es-MX and es-AR as Spanish).
5. THE system SHALL offer the languages in the menu bar on every tenant, business and customer screen, including the public pages before sign-in.
6. WHEN a signed-in user picks a language in the menu bar, THE system SHALL save it on their account and use it on every device they sign in to.
7. WHEN a user who is not signed in picks a language, THE system SHALL remember it on that device and save it on their account when they next sign in.
8. THE system SHALL change the language at once, without reloading the page or losing unsaved entries.
9. WHEN a signed-in customer picks a language, THE system SHALL also set it as the language on their customer record in the business they are using.
10. THE system SHALL show the System persona's screens in English and SHALL NOT offer the language choice to the System persona, including when a system administrator switches context to view a tenant or business.

### Coverage

#### Requirement 3: What Is Translated

**User Story**: As a Spanish-speaking user, I want every part of the application in Spanish, so that I do not meet English part way through a task.

##### Acceptance Criteria

1. THE system SHALL translate every tenant, business and customer screen: page titles, headings, labels, buttons, menu and tab names, column headings, placeholders, help text, empty states, confirmations, validation messages and notices.
2. THE system SHALL translate the public pages: sign-in and password reset, the booking widget, self check-in, and forms completed by customers.
3. THE system SHALL translate text that is read out but not shown, such as accessible labels for screen readers.
4. THE system SHALL translate the shared design-system components (for example tables, pagination, date pickers and dialogs) when they appear on a translated screen.
5. THE system SHALL return messages from the server (errors, validation and confirmations) in the language the user is viewing.
6. THE system SHALL NOT translate text entered by businesses or customers, such as location and resource names, notes, or the wording of a business's own templates and forms, except the translations a business keeps for its services, products, memberships, packages, service options and add-ons (Requirement 9).
7. THE system SHALL NOT translate the System persona's screens.
8. THE system SHALL show confirmations, notices and questions to the user in the application's own dialogs, with translated titles, messages and buttons, and SHALL NOT use the browser's built-in dialogs (whose title and buttons the application cannot translate) (owner, 24 Nov 2026).

#### Requirement 4: Dates, Times and Numbers

**User Story**: As a user, I want dates, times and numbers written the way they are in my language, so that I read them without effort.

##### Acceptance Criteria

1. THE system SHALL write dates, times, numbers and percentages in the format of Requirement 1, criterion 3.
4. THE system SHALL write dates, times and numbers in emails and documents in the default format of the recipient's language.
2. THE system SHALL show amounts in the business's own currency whatever the language, written in the format of the language being shown.
3. THE system SHALL keep showing appointment dates and times in the business's time zone.

### What Customers Receive

#### Requirement 5: Messages to Customers

**User Story**: As a business owner, I want customers to receive emails and documents in their own language, so that they understand them.

##### Acceptance Criteria

1. THE system SHALL send each customer email and document in the language on the customer's account.
2. WHEN the business has an active template in that language, THE system SHALL use it.
3. WHEN there is no active template in that language, THE system SHALL use the English template: the business's own first, then the system template.
4. THE system SHALL write the built-in wording of customer emails and documents (the plain email used when there is no template, PDF labels such as those on receipts and invoices, and completed-form PDFs) in the customer's language.
5. THE system SHALL send emails to staff in the language saved on the staff member's account, or English when they have none.

### Producing and Checking Translations

#### Requirement 6: Translation Script

**User Story**: As the owner, I want translations produced by Google's translation service instead of by hand, so that adding text or a language takes little effort.

##### Acceptance Criteria

1. THE system SHALL provide a script, run by a developer, that translates every English phrase that has no translation yet in each offered language, using Google's translation service.
2. THE script SHALL use the platform's Google API key held in System Configuration, or a key given to it when run.
3. THE script SHALL NOT change a phrase that already has a translation, so that a corrected translation is kept.
4. THE script SHALL keep fill-in values (for example a customer's name or a count) unchanged in the translated phrase.
5. THE script SHALL report what it translated and anything it could not translate.
6. THE system SHALL store the translations in files kept with the code, and SHALL NOT call the translation service while people use the application.
7. THE system SHALL address the reader with "tú" consistently in Spanish.

#### Requirement 7: Completeness Checks

**User Story**: As the owner, I want to know what is not translated yet and to stop broken translations, so that I can decide when a language is ready and every screen stays usable.

##### Acceptance Criteria

1. THE system SHALL report, for each offered language, every English phrase that has no translation, without failing the checks.
2. THE system SHALL fail its checks WHEN a translation's fill-in values differ from the English phrase's.
3. THE system SHALL fail its checks WHEN a tenant, business or customer screen or server message in scope shows text that is not taken from the translation files.
4. THE system SHALL run these checks with the existing tests, so that every new screen is held to them.

### The Business's Languages and Its Offerings

#### Requirement 8: The Business's Languages

**User Story**: As a business owner, I want to choose which of DayStream's languages my business supports, so that I only see and maintain the languages my customers use.

##### Acceptance Criteria

1. THE system SHALL let a business choose, in its settings, which of DayStream's languages it supports; its default language SHALL always be one of them.
2. THE system SHALL offer only the business's languages in the menu bar of those working in it (criterion 3), the language on its customer records, the languages of its document templates, forms and Check-In wording, its translation tables (Requirement 9), and the language menu of its public pages (booking widget, check-in, public forms).
3. WHILE someone works in a business (its staff, and its customers), THE system SHALL offer only the business's languages in the menu bar; WHEN their saved language is not one of them, THE system SHALL show the first of their own choices that the business offers, else the business's default language, and SHALL keep their saved choice (owner, 24 Nov 2026). Tenant-level and System screens offer every language.
4. THE system SHALL start each existing business with every language on the list when the setting is introduced, and a new business with its default language only, and SHALL NOT switch on for a business a language that DayStream adds later.
5. THE system SHALL let only those who can manage the business's settings change its languages.

#### Requirement 9: Translating Offerings

**User Story**: As a business owner, I want to keep my services, products, memberships and packages in each of my languages, with a machine translation to start from, so that customers read them in their own language without my typing every translation.

##### Acceptance Criteria

1. THE system SHALL let a business keep, for each of its languages other than its default, a translation of a service's, product's, membership's and package's name, short description and description, a service option's name, and an add-on's name and description.
2. THE system SHALL show them in a table opened by a Translate button on the record: a first row with the default-language text, read only, and one row for each of the business's other languages, each with its own Translate button.
3. WHEN Translate is pressed on a row, THE system SHALL fill that row with Google's translation of the default-language text, asking first when the row already has text, and THE system SHALL let the business edit every translation before and after saving.
4. THE system SHALL mark a translation out of date WHEN the default-language text has changed since the translation was made or saved.
5. THE system SHALL show customers the translation in the language being shown (the booking widget and the customer's pages), and SHALL fill template placeholders for these names and descriptions in the customer's language, using the default-language text WHEN there is no translation.
6. THE system SHALL let anyone who can manage services, products, memberships or packages translate them.
7. THE system SHALL call the translation service only WHEN a Translate button is pressed, with the platform's Google key, within the platform's daily limit.
---

## Dependencies

- Phase 03: Core Platform (users, tenants, businesses)
- Phase 04: Design System (shared components)
- Phase 51: Competitive Gaps (gap 11 closes with this phase; gap 17's templates per language)

## Success Criteria

- A device set to Spanish shows every tenant, business and customer screen in Spanish with no English text, except text the business or customer entered
- A user's language choice follows them to another device
- A customer whose account language is Spanish receives Spanish emails and PDFs, or the English template when the business has no Spanish one
- The checks report every phrase without a Spanish translation, and fail on a broken fill-in value or on text not taken from the translation files

## Out of Scope

- The mobile app - not built yet; it adds language support when it is built
- The System persona's screens - platform administration stays in English
- Text entered by businesses or customers - shown as typed
- Languages other than English and Spanish - added later by running the script for a new language
- Translating business templates and forms automatically - businesses already write a version per language
- Translating category, location and resource names - not needed (owner, 24 Nov 2026)
- Right-to-left languages - none planned

## Notes

- Google's Cloud Translation (Basic) gives 500,000 characters a month free and then charges $20 per million. DayStream's text is estimated at 150,000 to 250,000 characters, and only new or changed phrases are sent after the first run.
- The Cloud Translation API must be switched on in the Google Cloud project of the platform's Places key, and added to the key's allowed APIs if the key is restricted.
- Waivers, consent and other legal wording in the built-in text may need review by a Spanish speaker; a business's own forms are its responsibility.

---

**Status**: ✅ Complete (closed with the owner, 25 Nov 2026)
**Dependencies**: Phase 03, Phase 04, Phase 51
**Next Phase**: TBD
