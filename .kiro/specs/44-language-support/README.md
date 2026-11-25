# Phase 44: Language Support

**Status**: ✅ Complete
**Dependencies**: Phase 03 (Core Platform), Phase 04 (Design System), Phase 51 (Competitive Gaps)

---

## Documents

- **[requirements.md](./requirements.md)** - Languages offered, how the language is chosen, what is translated, customer messages, the translation script and checks
- **[design.md](./design.md)** - Saved language, translation files, server messages, emails, the translation command, the checks and the conversion order
- **[tasks.md](./tasks.md)** - Implementation task breakdown

---

## Overview

Language Support makes DayStream's tenant, business and customer screens, its public pages and everything it sends to customers available in more than one language, starting with Spanish (Spain). The System persona's screens stay in English, and text entered by businesses or customers is shown as typed.

The language shown is the user's saved choice, else the device's language, else English, and is changed from the menu bar. Translations are produced by a command that calls Google's translation service and are kept in files with the code; checks report untranslated phrases and fail on broken fill-ins. Each business chooses which languages it offers, and can translate its offerings' names and descriptions. This phase closes gap 11 of Phase 51.

**Core Features**:
- English and Spanish (Spain), with dates, numbers and country names in the device's format
- Language from the user's account, else the device, else English
- Customer emails and documents in the customer's language
- The business's languages and translated offerings
- Translation command (Google Cloud Translation) and completeness checks

---

**Last Updated**: November 25, 2026
