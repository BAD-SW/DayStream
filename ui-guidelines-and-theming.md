# DayStream — UI Guidelines & Theming Foundations

**Status:** Direction proposal — pair with the mockups in the published canvas (link at the bottom) before treating this as final.
**Scope:** General visual language for the app (typography, contrast, spacing, interactive states), plus the data model for the planned per-business theming feature (logo, font, font size, primary/secondary color). Not a re-skin — this keeps DayStream's existing cream/warm palette; it fixes readability and adds the missing structure to make per-business theming possible later.

---

## 1. Why this, and what we're borrowing from Momence

The complaint driving this: current screens read as low-contrast and cramped — small type, muted labels that don't stand out from their values, plain uniform white boxes for things that carry different meaning (every customer stage looks the same box), and no visual signal for what's clickable.

Momence was shared as a **structural** reference, not a visual one — we're not adopting its purple/blue palette. What actually makes it read as more usable, independent of its color choices:

- A clear hover state on list rows that makes "this opens something" obvious.
- Avatar/initial badges in list rows — a person's identity is scannable at a glance instead of just a text row.
- Status/type conveyed with color-coded pills, not uniform boxes.
- Section headers in the detail panel are bold and clearly separated from their content, with real spacing between sections instead of everything packed together.
- One obvious primary action, visually distinct from secondary ones.

Everything below translates those structural ideas into DayStream's own palette.

## 2. Type scale

Current sizes (measured from the Customers screenshots) run small and don't have much separation between levels — a page title, a table header, and a label are all fairly close in size and weight, which is part of why the page reads as flat.

Proposed scale:

| Role | Current (approx.) | Proposed |
|---|---|---|
| Page title ("Customers") | ~24px / 700 | **28px / 700** |
| Section header | — (not really distinct today) | **17px / 700** |
| Table header label | ~12px / 600, letter-spaced | **13px / 700**, letter-spacing 0.04em |
| Body / table cell text | ~13px / 400 | **15px / 400** |
| Form field label | ~13px / 400, low-contrast gray | **13.5px / 600**, darker gray (see §3) |
| Form field input text | ~14px | **15px** |
| Helper/meta text (e.g. row counts) | ~12px | **12.5px** |

This is a small bump in absolute terms but a meaningful one relatively — most importantly, it widens the *gap* between a label and its value, and between a header and body text, which is what actually reads as "clearer hierarchy," not just "bigger."

## 3. Color & contrast

Keep the existing palette (cream background, warm gold accent, white/cream cards) — the issue isn't the palette, it's that some text-on-background pairs are too close together.

**Rule going forward:** body text and field labels must hit **4.5:1** contrast against their background; large text (18px+/bold 14px+) and icons need **3:1**. Concretely, that means the current muted gray used for form labels and helper text (sampled around `#666666` on a `#F8F5EE`/white background — roughly 4.6:1, borderline) should not go any lighter than that, and several places currently at a lighter gray need to move down to a darker value to actually clear the bar rather than sit right at the edge of it.

**Status pills (Stage column) — one color per stage, reusing hues already introduced in the Dashboard grouping work** so the app is building one consistent color language rather than a new one per screen:

| Stage | Background | Text |
|---|---|---|
| Lead | `#EDE7D8` (neutral) | `#5B5B54` |
| Trial | `#E4EEF7` (blue — same family as the Dashboard's "Front Desk"/"Scheduling" accent) | `#33587F` |
| Active | `#E9F0E5` (green — same family as "Back Office"/"Catalog") | `#4B6B45` |
| At Risk | `#FBE8D3` (amber-orange, a distinct warning tone) | `#9A5B23` |
| Churned | `#F5E3DE` (muted terracotta) | `#8B4A3A` |
| Winback | `#EDE8F6` (lavender — same family as "Online Presence") | `#5B4E8A` |

Each pair above clears 4.5:1. Don't invent a 7th stage color from scratch if a new stage is ever added — pick from the same hue family the Dashboard already uses (see the earlier `dashboard-tile-grouping-option-c.md` spec) so status colors and dashboard-group colors read as one system.

## 4. Spacing

Introduce a spacing scale and use it everywhere instead of one-off pixel values: **4, 8, 12, 16, 24, 32, 48px**. Concretely for this page: form fields get 24px vertical gap between rows (currently tighter), grouped form sections (see §6) get 32px between groups, table cells get 16px vertical padding instead of the current denser spacing.

## 5. Interactive states

Define these once as reusable states, not per-component:

- **Hover** (rows, buttons, tiles): background shifts to a dedicated `--hover-bg` token; pointer cursor.
- **Focus** (keyboard navigation): a visible focus ring (2px, offset, using the accent color) on every interactive element — inputs, buttons, dropdown triggers, table sort toggles. ⚠️ Worth an explicit audit: the screenshots don't show a focus state, and if there isn't one today, this is a real accessibility gap independent of the Customers page work specifically.
- **Active/pressed**: a slightly darker/deeper version of the element's base color, momentary.
- **Disabled**: reduced opacity (~45%) + `cursor: not-allowed`, applied consistently (the "Schedule (Disabled)" module is one example already in the product).
- **Error/validation**: red-toned border + inline message below the field, not just a color change on the label.

## 6. Form layout pattern (for New Customer and future forms)

Group related fields under a small section header instead of one long unbroken list — e.g. for New Customer: **Basic Info** (First Name, Last Name, Email, Phone), **Details** (Date of Birth, Gender, Language, Country). This is a layout pattern to reuse on every future form, not a one-off for this screen.

---

## 7. Per-business theming — data model and how it should work

The long-run ask: let a business set its own logo, font, font size, and primary/secondary colors, configured somewhere in Settings/Business Setup.

**Config shape** (one record per business):

```ts
interface BusinessTheme {
  logoUrl: string | null;        // shown in the top bar in place of the wordmark, or beside it
  faviconUrl?: string | null;
  fontFamily: string;            // a curated list, not free-text — see below
  baseFontSize: 14 | 15 | 16 | 17; // a small fixed set of steps, not a free slider
  primaryColor: string;          // hex
  secondaryColor: string;        // hex
}
```

**Why constrained choices, not full freedom:**

- **Font family**: offer a short curated list (system default + a handful of licensed/Google Fonts that read well at UI sizes), not an arbitrary font upload. An arbitrary uploaded font is a real production risk (licensing, missing glyphs, poor hinting at small sizes) for very little benefit over a curated list.
- **Font size**: a small fixed set of steps (e.g. 14/15/16/17px base), not a continuous slider — a continuous value multiplies QA surface for very little user benefit over 4 clearly-different steps.
- **Colors**: primary/secondary as hex is fine, but **validate contrast on save** — if a business picks a primary color that would produce sub-4.5:1 text (e.g. pale yellow with white text), warn them and suggest an auto-adjusted lightness rather than silently accepting a color that makes their own app hard to read. This is the same rule from §3, just enforced at theme-save time instead of only in our own design decisions.

**How it should apply technically:** the theme resolves to a set of CSS custom properties (`--brand-primary`, `--brand-secondary`, `--font-family-base`, `--font-size-base`, plus derived tints/shades computed from primary/secondary, e.g. `--brand-primary-tint` for hover states) injected at the root of the app once the active business context is known — not per-component overrides. This means every component needs to consume colors and font through those custom properties rather than a hardcoded hex or font name.

**⚠️ This is the real prerequisite work, and it's invisible in a mockup:** the value of per-business theming is entirely gated on how many places in the current codebase have a hardcoded color/font value instead of a token reference. This session has no visibility into that — recommend a short audit pass (grep for hex literals and font-family declarations across the component library) as the actual first ticket here, before any theming UI gets built, since the UI is trivial compared to making every component actually obey the tokens.

**Where it lives in the product:** a new "Appearance" section, most naturally under **Settings** (business configuration) or **Business Setup** — see the mockup for a proposed layout (logo upload, font picker, size stepper, two color pickers, and a live preview panel showing a button/pill/header rendered with the chosen theme before saving).

---

## Mockups

See the published canvas for the redesigned Customers list, the redesigned New Customer form, and the proposed Appearance/theme settings screen, all built against this guidance: [DayStream UI Guidelines — mockups](https://claude.ai/code/artifact/4333f03c-d765-42c4-9953-24e220382d9b).
