# Competitive Comparison — MangoMint vs Momence vs DayStream

**Last Updated**: July 6, 2026
**Purpose**: Side-by-side feature and pricing comparison of DayStream against MangoMint and Momence, for competitive positioning and sales/strategy discussions.

**Sources & method**:
- **DayStream** — verified against the implementation (`docs/DAYSTREAM_OVERVIEW.md`, the module registry, route handlers, and specs). Pricing modeled at **$150/mo per location, all features included, no per-user or per-feature add-ons** (an internal average target, not market-tested).
- **MangoMint & Momence** — verified against their own public sites and help centers (mangomint.com, momence.com) plus third-party pricing reviews (vibefam, offeringtree), as of October 2026. Competitor descriptions are paraphrased from public sources for licensing compliance.

**Legend**: ✅ has it · 🟡 partial / narrower / add-on · ❌ not offered · ❔ not confirmed from public sources

---

## 1. Pricing

| | MangoMint | Momence | DayStream |
|---|---|---|---|
| **Model** | Per-location + per-user | Tiered + heavy add-ons | $150/mo per location, all-in |
| **Base subscription** | $120/mo per location + $10/mo per user | $0 Basic (5% txn fee), ~$60/mo Pro, ~$199/mo Custom | $150/mo per location |
| **Additional location** | $120/mo each | per-location add-on (varies) | $150/mo each |
| **Per-user seat cost** | $10/mo each | varies by tier/add-on | none — users included |
| **Payment processing** | 2.45% + 15¢ in person · 2.90% + 30¢ online | 3.9% + 30¢ online card | Stripe pass-through (business's own rate) |
| **Notable add-ons** | Phone +$70/mo/line · Payroll +$50/mo + $8/worker · Marketing from $30/mo | AI Agent ~$399/mo · SMS, video storage, onboarding extra | none — features included |
| **Transparency** | High — all public | Low — base public, real cost opaque | High (flat per location) |

### Worked cost comparison (subscription only, excludes payment processing)

> Assumptions: **DayStream = $150/mo per location, all features, no per-user or add-on fees.** MangoMint = $120/location + $10/user. Momence = ~$60 Pro base (single location) plus typical add-ons; real cost widely reported higher and opaque, shown as a range.

| Scenario | MangoMint | Momence | DayStream |
|---|---|---|---|
| Solo / 1 location, 3 users | $120 + 3×$10 = **$150/mo** | ~$60 base → **$250+/mo** reported | **$150/mo** |
| 1 location, 8 users | $120 + 8×$10 = **$200/mo** | **$250–600+/mo** typical | **$150/mo** |
| 1 location, 8 users + phone (1 line) + payroll (6 workers) | $200 + $70 + ($50 + 6×$8) = **$368/mo** | add AI Agent/equivalents → **$400–900+/mo** | **$150/mo** * |
| 5 locations, ~8 users each (40 users) | 5×$120 + 40×$10 = **$1,000/mo** | **$1,000–2,000+/mo** reported | 5×$150 = **$750/mo** |
| 20-location franchise, ~8 users each (160 users) | 20×$120 + 160×$10 = **$4,000/mo** | enterprise / custom | 20×$150 = **$3,000/mo** + franchise layer |

\* DayStream has no phone / payroll-processing add-ons because it **lacks those features** — not just unbilled.

**Read**:
- At a single small location the three land close (DayStream $150 = MangoMint $150 for 3 users; Momence's "$0/$60" headline is misleading — real spend reported at $250+).
- DayStream's advantage **widens with users and locations** — no per-seat and no per-feature fees: 8 users $150 vs MangoMint $200; 5 locations $750 vs $1,000; 20-location franchise $3,000 vs $4,000 — before counting the franchise/territory layer neither competitor has.
- **Honesty flag**: DayStream looks cheaper partly because it doesn't bill for phone, AI, EMR, or payroll processing — because it doesn't have them. A buyer who needs those pays MangoMint's add-ons and gets the capability. The cost win is real only where the buyer doesn't need DayStream's gap features.

---

## 2. Features

| Feature | MangoMint | Momence | DayStream |
|---|---|---|---|
| Appointment booking & calendar | ✅ | ✅ | ✅ |
| Group classes / sessions | 🟡 Group Services | ✅ class-centric (core strength) | ✅ shared/group booking |
| Online booking | ✅ | ✅ | ✅ |
| Embeddable booking widget | ✅ | ✅ | ✅ |
| Payments & POS | ✅ | ✅ | ✅ |
| Gift cards | ✅ | ✅ | ✅ |
| Memberships & packages | ✅ | ✅ | ✅ |
| Pricing / offers / discounts | ✅ | ✅ | ✅ |
| CRM / client management | ✅ | ✅ | ✅ |
| Lead management / sales pipeline | 🟡 light | ✅ leads + sequences | ✅ leads + lifecycle + custom stages |
| Marketing automation (email/SMS) | ✅ | ✅ (strength) | ✅ |
| Staff management & scheduling | ✅ | ✅ | ✅ |
| Payroll | 🟡 processing (add-on) | 🟡 pay rates / hours | 🟡 tracking + AP/accounting |
| Reporting & analytics | ✅ | ✅ | ✅ |
| Multi-location | ✅ | ✅ | ✅ |
| **Franchise / tenant / territory layer** | ❌ | ❌ | ✅ **unique** |
| **Prospect generation from territory data** | ❌ | ❌ | ✅ **unique** |
| Retail & inventory | ✅ inventory + Shopify | ❔ | 🟡 sells products; stock fields, no mgmt UI |
| Consumer mobile app | ✅ | ✅ | ✅ |
| Staff/business mobile app | ✅ | ❔ | ❌ |
| Integrated phone / telephony | ✅ Connect | ❌ | ❌ |
| Two-way texting / unified inbox | ✅ | ✅ | 🟡 inbox in progress |
| AI receptionist / assistant | ✅ Mira | 🟡 AI Agent add-on (~$399/mo) | ❌ |
| Forms & clinical charting / EMR | ✅ (med-spa EMR) | ❔ | ❌ lead forms + notes only |
| Virtual waiting room / client self-check-in | ✅ | ❔ | 🟡 waitlists + staff/kiosk check-in |
| Express "text-a-link to book & pay" | ✅ Express Booking™ | ❔ | 🟡 pieces exist, no one-tap flow |
| Events / workshops ticketing | 🟡 group services | ✅ core | ✅ dedicated events module |
| On-demand / livestream video, courses/LMS | ❌ | ✅ | 🟡 scaffolding |
| Community / social feed / gamification | ❌ | 🟡 some | ✅ feed, challenges, leaderboards, badges |
| Website CMS (pages, blog, SEO) | ❌ (widget only) | ❔ (marketing pages, not full CMS) | ✅ full CMS |
| Operator tooling (SQL query editor, audit log) | ❌ | ❌ | ✅ |
| Deep theming (dark-first, per-context brand) | ❌ | ❌ | ✅ |
| Legacy data migration | ✅ white-glove | ✅ white-glove | 🟡 self-serve intelligent import (building) |

---

## 3. Analysis

**Each product wins a different column — they don't compete head-on so much as serve different buyers.**

- **MangoMint** — deepest **front-desk / clinical** suite for salon/spa/med-spa: integrated phone (Connect), AI receptionist (Mira), clinical charting/EMR, inventory, Express Booking, payroll processing. Most **transparent pricing**. Polished, fixed UI. Single-business (multi-location within one account).
- **Momence** — strongest on **classes, marketing, and content**: class-centric booking, built-in marketing with lead sequences, on-demand/livestream video and courses, consumer app. Positioned for hybrid (in-studio + online) fitness/yoga. **Low entry price but opaque, escalating real cost.**
- **DayStream** — the only one with a **franchise/tenant/territory platform layer**, **prospect generation**, a **full website CMS**, **community/engagement** (feed, challenges, LMS scaffolding), and **operator-level tooling** — plus deep resource modeling for the premium wellness/recovery vertical (float/sauna/cold-therapy).

**DayStream's defensible uniques** (neither competitor has): franchise/territory architecture + prospect generation, full website CMS, operator SQL/audit tooling, owner-themeable design system.

**DayStream's clear gaps vs the field**: integrated phone, AI assistant/receptionist, forms & clinical charting/EMR, staff/business mobile app, shipped on-demand video/courses, inventory management UI.

**Pricing as a selling point**: DayStream's flat, all-inclusive $150/location is predictable like MangoMint, cheaper at scale (no per-seat, no add-ons), and the clean counter to Momence's opaque escalation. Strongest where the buyer doesn't need MangoMint's phone/AI/EMR gap features.

**One-line takeaway**: MangoMint for a salon/med-spa that needs front-desk depth; Momence for a studio that lives on classes and content marketing; **DayStream for an organization running or selling *multiple* wellness businesses**, where the franchise/territory layer, website CMS, and flat per-location pricing are the real edge.

---

## 4. Caveats (read before using externally)

- **Feature presence, not depth or UX quality.** A ✅ does not mean equal polish; MangoMint's UX and Momence's content/marketing are mature, and DayStream may trail on execution even where it "has" the feature.
- **Cheaper ≠ better value when it's due to missing features.** DayStream avoids phone/AI/EMR/payroll add-on fees partly because it lacks those features.
- **❔ = unverified, not "no."** Several Momence cells (website builder, charting, waiting room, staff app, inventory depth, AI depth) could not be confirmed from public pages — verify before claiming them as gaps.
- **Pricing drifts.** MangoMint figures are from its site/`llms.txt`; Momence base tiers are public but the full rate card is not (real cost reconstructed from reviews); DayStream's $150 is an internal average, not market-tested. Re-verify before publishing.
- **DayStream "in progress" items** (unified inbox, data migration, newer marketing module) are built-but-not-complete — do not present as finished in a bake-off.
- **Not built anywhere in DayStream**: AI features and full multi-language — per `docs/DAYSTREAM_OVERVIEW.md`, "do not claim these."

---

## Source-of-truth pointers

- `docs/DAYSTREAM_OVERVIEW.md` — the authoritative "what's built" record for DayStream.
- `.kiro/specs/` — implementation specs (what's built, by feature).
- MangoMint: mangomint.com (features, solutions, pricing, `llms.txt`).
- Momence: momence.com + help.momence.com; third-party pricing reviews.
