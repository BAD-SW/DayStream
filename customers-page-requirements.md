# DayStream — Customers & New Customer Page: Requirements

**Status:** Ready for implementation
**Scope:** Business persona → Customers list page + the "Add Customer" (New Customer) form. No other screens affected by this document (see the separate `ui-guidelines-and-theming.md` for the general look & feel work).
**Source:** Authored from two screenshots of the live pages (this session has no access to the DayStream repo) — data-model assumptions below are flagged ⚠️ and should be confirmed against the real `Customer` entity before implementation.

---

## A1. Import / Export

**Current state:** an "Export CSV" button only.

**Add:** an "Import CSV" action alongside it (button group: `Import CSV` / `Export CSV` / `Add Customer`, in that order, left of the primary button).

**Import flow:**
1. File picker (`.csv` only for v1).
2. **Column-mapping step** — show the uploaded file's header row and let the user map each column to a `Customer` field (First Name, Last Name, Email, Phone, Date of Birth, Gender, Language, Country, Stage). Auto-suggest mappings by matching header names case-insensitively (`"first name"` → First Name, etc.). Unmapped columns are ignored; required fields left unmapped block the import with an inline error.
3. **Validation preview** — before committing, show a table of rows that will fail (missing required field, malformed email, phone that fails the country validation from §A5, duplicate email already in the system) with the specific reason per row. The user can proceed with only the valid rows, or cancel and fix the file.
4. **Commit + summary** — "Imported 42 customers, skipped 3 (view errors)" with a downloadable CSV of just the skipped rows and their error reasons, so the user can fix and re-import only those.

⚠️ Open question: should import **match existing customers by email and update them**, or is it **create-only**? Recommend create-only for v1 (skip/flag a row whose email already exists, don't silently overwrite) — confirm with product before building update-merge logic, which is a materially bigger feature.

**Export:** keep CSV export, but it should export **the currently filtered/sorted view** (per §A3), not always the full unfiltered customer list — i.e. "export what I'm looking at." Column order in the export matches the visible table columns (post-split, see §A2).

---

## A2. Split "Name" into "Name" and "Surname(s)"

⚠️ The "Add Customer" form already collects **First Name** and **Last Name** as separate fields, so the underlying data almost certainly already has them separate — this should be a display-only change to the list table, not a data migration. Confirm the field is literally called `lastName` (not `surname`) in the schema and use that as the source of truth; "Surname(s)" here is just the column label.

**Table columns, in order:** `REF` · `Name` · `Surname(s)` · `Email` · `Phone` · `Stage` · `Joined`.

Each of `Name` and `Surname(s)` gets its own sort toggle (currently a single combined "Name ⇅" sort — split into two independent sort controls, same interaction pattern the other columns already use).

---

## A3. Per-column filters (replace the single "Search customers" box)

**Remove:** the single global `🔍 Search customers…` input.

**Add:** a filter row directly under the column headers (or a filter control attached to each header — whichever matches how the rest of the app already does per-column filtering, if it does it anywhere; if this is the first place, this becomes the pattern to reuse elsewhere later).

| Column | Filter type |
|---|---|
| REF | text, "contains" |
| Name | text, "contains" |
| Surname(s) | text, "contains" |
| Email | text, "contains" |
| Phone | text, "contains" |
| **Stage** | **dropdown** (single-select for v1; multi-select is a reasonable v2) — options: Lead, Trial, Active, At Risk, Churned, Winback |
| **Joined** | **date / date-range picker** — a popover with quick presets (Today, Last 7 days, Last 30 days, This month, Custom range) plus explicit From/To date fields for the custom case |

Filters combine with AND logic. Clearing a filter removes that condition, not the others.

**Recommended (not required) enhancements:**
- Make the 6 stage stat tiles at the top (Lead/Trial/Active/At Risk/Churned/Winback counts) clickable — clicking one sets the Stage filter to that value, so the counts double as filter shortcuts.
- Reflect active filters in the URL query string so a filtered view is a shareable/bookmarkable link.

---

## A4. Row hover state — make "click = edit" unambiguous

Currently rows have no distinct hover treatment, so it isn't obvious the row is clickable.

**Add:**
- On hover: a subtle background tint on the whole row (a new `--row-hover-bg` token — do not reuse the selected-tile tan from the Dashboard tiles, that's a different affordance; this should read as "hover," not "selected").
- `cursor: pointer` on the row.
- A trailing affordance that only appears on hover — a `›` chevron or the word "Edit" — right-aligned in the row. This is the important part: **don't rely on the background tint alone** to communicate clickability (a color-only signal is also an accessibility gap) — the appearing icon/label is what actually tells the user what a click does.

---

## New Customer screen

## A5. Country field + phone validation

- **Country**: change from free-text to a **dropdown** (searchable/typeahead — a plain `<select>` with ~195 entries is unusable). Standard ISO 3166-1 country list with English names.
- **Phone**: prefix the phone input with a **country-code selector** (flag + dial code, e.g. "🇪🇸 +34"), and **validate the entered number against that country's expected format** (length + pattern) before allowing submit. Recommend [`libphonenumber-js`](https://www.npmjs.com/package/libphonenumber-js) — it's a much smaller dependency than Google's full `libphonenumber` and covers format + length validation, which is all that's needed here (this isn't a carrier-verification feature).
- **Default country code**: default the phone country-code selector to the **business's own country** (Spain, for Transcend Mallorca) rather than a hardcoded default — falls back to a generic default (e.g. US) only if the business itself has no country set.
- **Relationship between the two fields**: selecting a value in the Country dropdown auto-selects the matching phone country code as a convenience default, but the two remain independently editable — a customer can live in one country and have a phone number from another (common for expats/tourists at a wellness business like Transcend Mallorca).

## A6. Gender dropdown — remove "Non-binary"

Remove the "Non-binary" option from the Gender dropdown. ⚠️ This spec doesn't redefine the full remaining option list — confirm the current full set of options with the team and just remove that one entry, keeping everything else (including the default blank `—` state) as-is.

---

## Acceptance criteria

- [ ] Import CSV: mapping step, validation preview, commit summary with a downloadable error report for skipped rows, as in §A1.
- [ ] Export CSV respects active filters/sort.
- [ ] Table shows separate, independently-sortable `Name` and `Surname(s)` columns.
- [ ] Global search box is gone; every column has its own filter, combining with AND logic; Stage is a dropdown, Joined is a date/date-range picker with presets.
- [ ] Hovering a customer row shows a background tint, pointer cursor, and a trailing chevron/"Edit" affordance that only appears on hover.
- [ ] New Customer: Country is a searchable dropdown; phone has a country-code prefix and is validated against that country's format; Gender dropdown no longer offers "Non-binary."
- [ ] No regression to existing customer creation, editing, or the stat tiles' counts.

## Open questions for the team

1. Import: create-only, or match-and-update by email? (§A1)
2. Confirm the `Customer` entity's actual field name for surname (`lastName` assumed) before wiring the column split. (§A2)
3. Does any other list in the app already do per-column filtering? If so, reuse that exact pattern/component rather than inventing a second one. (§A3)
4. Confirm the full current Gender option list so "remove Non-binary" is scoped precisely. (§A6)
