# How Prospect Search Works Today — Walkthrough for Evaluation

**Last Updated**: October 25, 2026
**Purpose**: A plain-language, end-to-end description of how a territory is defined and how
that definition drives the prospect search, so the approach can be evaluated before a
redesign. This describes the system **as currently built**.

> Companion documents: `PROSPECT_SEARCH_REDESIGN_NOTES.md` (findings + why a redesign is
> needed) and the data-source question (Google Places was chosen for cost/convenience, not
> because it was evaluated as the most complete source).

---

## The two phases

Prospecting happens in two separate phases:

1. **Define the territory** (system admin, done once per tenant) — turn a named area into a
   set of map tiles stored in the database.
2. **Generate prospects** (run on demand) — search Google Places across that territory and
   save the businesses found.

The key design idea connecting them: the territory is stored as a grid of **H3 hexagons**
(Uber's hexagonal geospatial grid), and the search both *sweeps* those hexagons and uses
them as a *filter*.

---

## Phase 1 — Defining a territory

### Step 1: Admin searches for an area
In the tenant's Territory screen, the admin types a place name (e.g. "Monroe County, New
York"). The system resolves it to one or more **boundary candidates** — like Google Maps, a
single query can match a city vs. a county vs. a state, so the admin is shown the options
with a preview of each.

- Boundaries come from an external lookup (OpenStreetMap/Nominatim, with results cached).
- Each candidate returns a **GeoJSON boundary polygon** (the actual shape of the county,
  region, island, etc.), a center point, and a bounding box.
- If no real administrative boundary exists for an informal name, the system offers an
  **approximate rectangle** (the geocoder's bounding box), clearly flagged as approximate.

### Step 2: The boundary is tiled into hexagons
Each candidate's boundary polygon is "filled" with H3 hexagons (`polygonToCells`):

- Tiling starts at **resolution 7** (hexagons roughly ~1.6 km across) and, if the area
  produces too many cells, automatically **coarsens** (7 → 6 → 5) until the whole area fits
  a budget of **10,000 cells**. This keeps a large region (e.g. a whole state) from
  exploding, at the cost of coarser tiles.
- A **composed territory** (several counties selected together, as with US-NY-1's 10 WNY
  counties) is tiled as a **union** of all component boundaries, coarsened together so the
  combined set stays within budget.
- Non-contiguous areas are handled (e.g. Hawaii's separate islands each get their own
  ring).

The admin sees the hex count and whether coverage is "complete" before saving.

### Step 3: Saving the territory
On save (`PUT /territories/:tenantId`):
- The resulting hexagons are stored, one row per hex, in **`prp_tenant_territories`**
  (`tenant_id`, `h3_index`). WNY (US-NY-1) currently stores ~1,457 searchable hexes; the
  expanded territories have more.
- The tenant record keeps the center point, a human-readable label
  (`territory_address`), and the list of component areas (geometry is stripped and
  re-looked-up on demand to keep the row small).
- **A population filter runs** (optional, only where population data exists): for each
  stored hex, the system looks at finer sub-cells against a `prp_population_lookup` table
  and marks hexes with no meaningful population as **`is_searchable = false`**, so empty
  countryside isn't searched. If there's no population data for the region, all hexes stay
  searchable.

**End state of Phase 1:** the territory is a set of H3 hexagons (res 5–7) in the database,
each flagged searchable or not.

---

## Phase 2 — Generating the prospect list

Triggered by the admin (now a background job that returns immediately and reports progress).
Cost is incurred here, because this is what calls Google.

### Step 1: Collapse territory into "search centers"
The stored territory hexes are fine (res 7). Searching each one individually would be far
too many Google calls. So the system **collapses** them to their **resolution-4 parents**
(`cellToParent`) — hexagons roughly ~29 km across — and de-duplicates. The US-NY-1 territory
(~1,457 searchable res-7 hexes) collapses to roughly **18–25 res-4 "search centers."**

Each search center is a point (the hex center's lat/lng) with a large radius (~29 km) used
to bias the Google search toward that area.

### Step 2: For each category × each search center, query Google Places
Categories are configured globally (e.g. "Spas & Recovery Centers," "Massage Therapy,"
"Beauty & Hair"), each defined as a set of keywords combined into one **OR query** (e.g.
`Massage therapist OR Massage spa OR Thai massage OR ...`).

For every category, the engine loops the search centers and calls Google Places **Text
Search**:
- Google returns up to **20 results per page, 3 pages = 60 max** per query.
- The engine pages through (up to 3 pages) to pull up to 60 results per center.

### Step 3: Drill down into "saturated" areas
Here is the core mechanism — and the part under review:

- If a search center returns a full 3 pages **and Google signals there are more results**
  (it returns a "next page token" after page 3), the center is considered **"saturated"** —
  i.e. there are assumed to be more than 60 businesses there than the cap can return.
- A saturated cell is **split into its 7 finer H3 children** (one resolution deeper), and
  each child is searched the same way — **recursively**, down to a finest resolution of
  **res 9** (~0.17 km hexes). The intent is to break a dense area into small enough pieces
  that each returns under 60 results, so nothing is missed.
- Results from all levels are **unioned and de-duplicated** by Google Place ID.

A per-run **API-call budget** (currently 8,000) caps the total; if hit, the run stops and is
flagged "partial."

### Step 4: Geographic filter (keep only what's really in the territory)
Google's radius search is circular and spills outside the real boundary. So each returned
business is placed into its own res-7 hex (`latLngToCell`), and **discarded if that hex is
not one of the territory's stored hexes.** This is the second use of the hex grid: the
territory tiles act as the precise in/out boundary test.

### Step 5: Save and reconcile
For each surviving business:
- Upsert into **`prp_prospects`** keyed on `(tenant_id, google_place_id)` — new ones added,
  existing ones updated (name, address, phone, website, rating, review count, lat/lng).
- Businesses that were present before but **not** returned this run are marked
  `is_active = false` (kept for history, dropped from the active list).
- A generation-log row records counts and the (estimated) cost.

**End state of Phase 2:** `prp_prospects` holds the tenant's list; the active subset is what
the tenant works from.

---

## How the territory definition is *used* (the thread to evaluate)

The H3 hex grid created in Phase 1 is used **three** ways in Phase 2:

1. **Where to search** — collapsed to res-4 centers that seed the Google queries.
2. **How deep to search** — drilling subdivides those cells when Google signals saturation.
3. **What to keep** — every result is accepted only if it lands in a stored territory hex.

So the territory boundary is honored precisely for *filtering* (step 3/4 above), but the
*discovery* depends entirely on Google Places returning the businesses in the first place.

---

## Known weaknesses to weigh in the evaluation

These are documented in detail in `PROSPECT_SEARCH_REDESIGN_NOTES.md`; summarized here so
this walkthrough is self-contained:

- **Completeness depends on Google's flaky "more results" signal.** That token is
  inconsistent — often absent even in dense areas (so businesses are missed) and sometimes
  present on sparse cells (so the engine over-drills). Completeness therefore can't be
  guaranteed, which is the opposite of what the feature needs.
- **Over-searching.** Measured on Oahu: a saturating center burned ~500+ API calls to find
  ~60–80 businesses (~8 calls per business), and one real run consumed ~23,000 calls for a
  territory with an estimated ~150 real businesses.
- **Non-deterministic.** The same territory can return different lists on repeat runs
  because saturation flips.
- **60-result cap is structural.** Google Places is a maps/discovery API, not a business
  directory — the drilling exists purely to work around the cap.
- **Broad OR keywords inflate false saturation** and loosen category precision.
- **Data-source fit.** Google Places was chosen for low cost and easy global integration,
  not because it was evaluated as the most complete source of businesses. Whether a
  maps-discovery API is the right foundation for an exhaustive B2B prospect list is the
  central question for the redesign.

---

## Quick reference — where this lives in the code

| Concern | File |
|---|---|
| Resolve area → boundary candidates, preview, save territory | `packages/server/src/routes/prospects.ts` |
| Tile boundary → hexes, collapse to search centers, population filter | `packages/server/src/services/h3-territory.service.ts` |
| Google Places queries, pagination, saturation + recursive drill | `packages/server/src/services/google-places.service.ts` |
| Orchestration, geo-filter, upsert, budget, background run | `packages/server/src/services/prospect-generation.service.ts` |
| Territory hex storage | table `prp_tenant_territories` |
| Prospect storage | table `prp_prospects` |
| Categories (keywords per category) | table `prp_category_mappings` |
