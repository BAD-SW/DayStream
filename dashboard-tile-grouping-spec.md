# DayStream Dashboard — Tile Grouping (Option C) Implementation Spec

**Status:** Ready for implementation
**Scope:** Business-persona Dashboard screen only (the tile grid below the stat row). No other screens affected.
**Chosen direction:** "Option C — by team/role" from the grouping exploration — 4 groups, colored left-accent bar + icon badge per group.
**Reference:** [DayStream Dashboard Groupings canvas](https://claude.ai/code/artifact/4f6a3b7e-5ea0-4c4e-aaa9-c55e788f55e3), Option C artboard.

> A note on how this spec was produced: it was authored from two screenshots of the live Dashboard and the project's `CLAUDE.md`, not from the actual component source (this session had no access to the DayStream repo). The visual values below (colors, spacing) are close approximations, not extracted design tokens — **the implementing engineer should reconcile them against the real `Tile`/`Card` components and the app's actual token file** rather than hardcoding new ones. Anywhere this matters is flagged inline as ⚠️.

---

## 1. What's changing

Today the Dashboard renders a single flat grid of 10 tiles (one per sidebar module), in a user-configurable order ("Reset tile order" link at the bottom implies drag-to-reorder + a per-user stored order, reset to default).

The change: wrap the same 10 tiles in **4 named group containers**, each with a colored left-accent bar, a small icon badge, and a label. The stat-row above and the tiles themselves (icon, title, description, click behavior) are **unchanged** — this is purely a layout/grouping change around existing tiles.

## 2. The groups

| Group | Accent color | Modules (in order) |
|---|---|---|
| **Front Desk** | `#4A7FB5` (blue) | Appointments, Schedule (Disabled), Customers |
| **Back Office** | `#6B8F63` (green) | Accounting, Reports |
| **Growth** | `#C77B3E` (orange) | Marketing, Offerings, Website |
| **Admin** | `#8064B0` (purple) | Business Setup, Settings |

Rationale: Front Desk = what reception/staff touch every day (booking + the customer record); Back Office = the numbers; Growth = anything aimed at getting more customers/revenue; Admin = one-time/occasional configuration. This covers all 10 current tiles exactly once — nothing added, nothing dropped.

### Feature-flagged modules (Events, Community)

`CLAUDE.md` notes Events and Community exist behind feature flags and aren't in the current 10-tile set. When either flag is on, this spec proposes:

- **Events** → **Growth** (workshops/events are a growth/marketing activity)
- **Community** → **Growth** (engagement features, same rationale)

This is a judgment call, not a hard requirement — it's called out separately so whoever owns those flags can override it in the config (see §4) without touching layout code.

## 3. Visual spec

### Page-level grouping grid

- Container: CSS grid, `grid-template-columns: repeat(2, minmax(0, 1fr))`, `gap: 20px`.
- 4 groups → 2 rows of 2. On a viewport narrower than **~900px**, collapse to `repeat(1, 1fr)` (single column, groups stacked).
- This grid replaces the current flat tile grid; it lives in the same content area, below the 3 stat cards, above the "Reset tile order" link.

### Group container (per group)

```
┌ border-left: 4px solid <accent> ─────────────────
│  border: 1px solid <card-border>, border-radius: 10px
│  background: <card-bg>  (white in light mode)
│  padding: 16px 16px 16px 15px  (1px less on the left to
│    compensate for the 4px accent border)
│
│  ┌─ header row (flex, gap 9px, margin-bottom 14px) ──
│  │  ○ icon badge: 26×26px circle,
│  │      background = <accent> at ~13% opacity,
│  │      icon color = <accent>, icon 18×18px inline SVG
│  │  ●  label: 13px / 700 weight / letter-spacing 0.03em /
│  │      text color = primary text color (not the accent)
│  └──────────────────────────────────────────────────
│
│  ┌─ tile grid ─────────────────────────────────────
│  │  existing Tile component, unchanged, laid out with
│  │  CSS grid: repeat(auto-fill, minmax(180px, 1fr)),
│  │  gap 12px  ⚠️ (see §6 — prefer auto-fill over a fixed
│  │  2-or-3-column rule so it doesn't need per-group logic)
│  └──────────────────────────────────────────────────
└────────────────────────────────────────────────────
```

Group header icons (badge only — tile icons themselves stay as-is): inline SVG, stroke-based, 24×24 viewBox, `stroke-width: 1.8`, `stroke: currentColor`, `fill: none` — not emoji, not a font icon. Suggested glyph per group: Front Desk = a simple desk/counter icon, Back Office = a bar-chart icon, Growth = a tag/price-tag icon, Admin = a briefcase icon. Exact SVG paths are in the published artboard if you want to lift them directly (view source of Option C in the canvas).

### Dark mode

The app already respects a dark/light toggle app-wide, so this needs a dark variant:

| Token | Light | Dark (⚠️ proposed — verify against real dark tokens) |
|---|---|---|
| Group container background | white / existing card bg | existing dark card bg |
| Group container border | existing light card border | existing dark card border |
| Front Desk accent | `#4A7FB5` | `#6FA0D8` (lightened for contrast) |
| Back Office accent | `#6B8F63` | `#8FBF86` |
| Growth accent | `#C77B3E` | `#E0A468` |
| Admin accent | `#8064B0` | `#A98AD1` |
| Icon badge background | accent @ 13% opacity | accent @ ~20% opacity (needs more alpha to read on dark bg) |
| Label text | primary text (dark) | primary text (light) |

Do not hardcode a second set of hex values without checking whether the app already has a dark-mode color-mixing utility (e.g., a `mix(accent, background)` helper) — if one exists, use it instead of the fixed hex table above.

## 4. Data model (config-driven, not hardcoded JSX)

Group membership should live in one config object, not be scattered across markup, so re-grouping later is a data change, not a layout change:

```ts
type DashboardGroupId = "front-desk" | "back-office" | "growth" | "admin";

interface DashboardGroupConfig {
  id: DashboardGroupId;
  label: string;
  accentColor: string;      // light-mode hex
  accentColorDark: string;  // dark-mode hex
  icon: React.ComponentType; // the badge SVG icon
  moduleIds: string[];      // module/tile ids, in display order within the group
}

const DASHBOARD_GROUPS: DashboardGroupConfig[] = [
  {
    id: "front-desk",
    label: "Front Desk",
    accentColor: "#4A7FB5",
    accentColorDark: "#6FA0D8",
    icon: DeskIcon,
    moduleIds: ["appointments", "schedule", "customers"],
  },
  {
    id: "back-office",
    label: "Back Office",
    accentColor: "#6B8F63",
    accentColorDark: "#8FBF86",
    icon: ChartIcon,
    moduleIds: ["accounting", "reports"],
  },
  {
    id: "growth",
    label: "Growth",
    accentColor: "#C77B3E",
    accentColorDark: "#E0A468",
    icon: TagIcon,
    moduleIds: ["marketing", "offerings", "website", "events", "community"], // last two only render if their flags are on
  },
  {
    id: "admin",
    label: "Admin",
    accentColor: "#8064B0",
    accentColorDark: "#A98AD1",
    icon: BriefcaseIcon,
    moduleIds: ["business_setup", "settings"],
  },
];
```

Rendering logic: for each group, filter `moduleIds` down to modules that (a) exist in the current tenant/business's enabled module list and (b) pass their feature flag — exactly the same gating the current flat grid already does per-tile, just applied per-group instead of globally. **A group with zero visible modules after filtering should not render at all** (e.g., if some future config leaves a group empty).

## 5. Interaction with tile reordering ("Reset tile order")

⚠️ This is the one piece that needs a product/engineering decision, since this session couldn't inspect how ordering is currently stored:

**Recommendation:** scope drag-to-reorder to *within* a group, not across groups. Group membership becomes fixed (config-driven, per §4), and only the order of tiles *inside* a group stays user-customizable. "Reset tile order" resets each group's internal order back to the config's default `moduleIds` order — it does not change group membership.

If the current implementation stores order as a single flat array of module ids, that can stay unchanged; just render each group by filtering that flat array down to its `moduleIds` and preserving relative order, rather than introducing a new nested storage shape. That avoids a data migration.

If cross-group drag turns out to be a requirement (a user wants to move "Reports" out of Back Office into their own custom group), that's a materially bigger feature — flag it back to product rather than assuming it's in scope here.

## 6. Implementation notes / gotchas

- **Reuse the existing Tile/Card component as-is.** Nothing about a tile's internal markup, click behavior, disabled state (`Schedule (Disabled)`), or icon changes — only what wraps it changes.
- **Tile grid columns:** don't hardcode "2 columns, or 3 if there are exactly 3 tiles" — that was a mockup shortcut. Use `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` (or whatever min-width matches the real Tile component's natural width) so the grid fills evenly regardless of group size, including after a feature flag adds Events/Community to Growth.
- **Accessibility:** each group container should be a labelled region — `role="region" aria-labelledby="<group-id>-heading"` with the label as an `<h2>`/`<h3>` (whatever heading level fits the existing page hierarchy), not just a styled `<div>`. The colored accent bar is decorative only — group identity must not depend on color alone (the label text + icon already cover this).
- **Icon badge contrast:** the badge is decorative (icon inside a tinted circle), not a text-on-color contrast case, so the accent colors above don't need to individually pass WCAG text-contrast — but do check the icon itself is visible against its tinted background in both modes.
- **Empty/loading states:** if the tile list is still loading or a business has very few modules enabled, groups with 0–1 visible tiles should still render (don't special-case "only show groups with 2+ tiles") — just let the grid do its thing.

## 7. Acceptance criteria

- [ ] All 10 current modules appear exactly once, inside the group listed in §2, with their existing icon/title/description/click-through unchanged.
- [ ] 4 group containers render with the correct accent color, icon, and label from §2/§4.
- [ ] Layout is a 2×2 grid ≥900px viewport width, collapsing to a single column below that.
- [ ] Dark mode toggle correctly swaps accent colors and container background/border per §3.
- [ ] "Reset tile order" resets in-group order without changing group membership.
- [ ] A module hidden by a feature flag or not enabled for the business does not render an empty slot, and does not leave its group empty-looking if it was the only module in that group.
- [ ] Enabling the Events and/or Community feature flag adds those tiles into the Growth group without any layout code changes (config-only change).
- [ ] No visual regression to the stat-row cards above or the "Reset tile order" link below — only the tile grid itself changes.

## 8. Open questions for the team

1. Does tile order currently persist per-user, per-business, or is it local-only (browser storage)? This determines exactly where the "in-group order" logic in §5 needs to plug in.
2. Is there an existing dark-mode color-mixing utility in the design system, or should the dark accent hexes in §3 be added as literal new tokens?
3. Confirm the Events/Community → Growth placement in §2, or reassign.
4. Confirm the ~900px collapse breakpoint against the app's existing breakpoint scale (this session guessed a round number; the app likely already has named breakpoints to reuse).
