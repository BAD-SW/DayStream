# Prospect Search — Re-engineering Notes (design input)

**Status**: 🔴 Needs redesign — do NOT treat the current algorithm as trustworthy
**Purpose**: Capture what we learned so the next session starts from evidence, not from scratch.
**Last Updated**: October 25, 2026

> This is a design-input note, not a spec. When the redesign is picked up, it should go
> through the normal spec flow (requirements → design → tasks) with the current
> `31-prospect-management` spec as the anchor.

---

## The problem in one line

The prospect search is **inefficient and its completeness is unreliable** — it cannot be
trusted to return "all the businesses in a territory," which is the single most important
property for a tenant owner's first prospect list.

## What is good enough to keep (fixed Oct 25)

These were real fixes and are committed; they make the current system *safe*, not *good*:

- **No more hang.** Outbound Google fetch timeout now covers the response body read (a
  stalled body read previously deadlocked a concurrent worker). Generation is a background
  job (202 + status polling), so a slow run never freezes the request/UI.
- **No more cost runaway.** The drill is a single shared work-queue with one global
  concurrency cap and a per-call budget reservation; a run cannot exceed its API-call
  ceiling by more than ~`DRILL_CONCURRENCY × 3` calls (proven). Default budget 8,000.
- **Usage visibility.** The admin screen shows authoritative month-to-date Places calls
  vs. the free allowance (Google Cloud Monitoring via keyless ADC).

## What is broken (the reason for the redesign)

**The saturation-driven recursive drill-down is the wrong engine.**

Evidence measured on the Oahu (US-HI-1) territory, 3 active categories:

- **Spas & Recovery Centers**: 167 found, **0 of 25 centers saturated, 0 drill calls** —
  a single res-4 pass was clean and complete.
- **Massage Therapy**: saturating centers each burned **~513 API calls to net 60–80
  businesses** (≈ **8 calls per business**), and was still capped mid-drill.
- A real Oahu run consumed **~23,000 calls** and then errored out — for a territory the
  user estimates at **~150 businesses** on Google Maps across all three categories.

### Root causes

1. **`next_page_token` is an unreliable saturation signal.** Google returns a page-3
   "more results" token inconsistently:
   - It is often **absent even in genuinely dense areas** (e.g. Waikiki "spa OR massage OR
     salon" returned not-saturated), so dense areas are likely **under-captured**.
   - It is sometimes **present on cells with few real results**, so the cell "saturates"
     and drills into 7 children that re-find the same places — a false-saturation cascade
     that burns hundreds/thousands of calls finding little new.
   - Identical requests to the same cell flip between saturated / not-saturated.
2. **Broad OR-keyword queries inflate false saturation.** Queries like
   "Massage therapist OR Massage spa OR Thai massage OR Sports massage OR Deep tissue
   massage" easily return 60 loosely-matching results + a token in a 29km radius, triggering
   drill-down even when the true distinct count is small.
3. **Drill cost scales with cells, not with businesses.** 7× fan-out per level to res 9
   means a saturating center can touch thousands of sub-cells, each costing 3 calls, mostly
   re-finding the same businesses.
4. **Result is non-deterministic.** Because saturation is flaky, the same territory can
   return materially different lists on repeat runs.

## Candidate directions for the redesign (not yet decided)

Evaluate against: **completeness first**, then cost, then speed, then determinism.

1. **Fixed-resolution tiling (leading candidate).** Tile the territory at a single fine
   resolution (res 7 matches how territories are already stored) and search each tile once,
   no conditional drilling. Deterministic coverage and predictable cost; no runaway, no
   flaky-token dependence. Tune the resolution per expected density.
2. **Shallow search + targeted densify.** Single pass per center; only densify a tile when
   it returns a *full 60 distinct, relevant* results (measure distinctness, not the token).
3. **Different data source / API.** Evaluate the newer Places API (New) — the current code
   uses the legacy `textsearch` endpoint Google is deprecating — and whether its paging /
   nearby semantics give a more reliable "is there more here?" signal.
4. **Validate against ground truth.** Whatever the approach, measure it against a
   known-count area (e.g. a few Oahu blocks counted by hand on Google Maps) so we can state
   actual recall, not assume it.

## Must-haves for the redesign

- **Automated tests with a STUBBED Google client.** Every bug this session (false
  saturation, cost runaway, the deadlock) hid behind Google's non-deterministic responses.
  Stubbed responses that force saturation / timeouts / empty pages would have caught them.
- **A ground-truth recall check** on at least one dense and one sparse territory.
- **Deterministic output** for the same territory + categories.
- **Cost that is explainable up front** (calls ≈ f(tiles), not f(flaky saturation)).

## Open questions for the next session

- What recall % is "good enough" for a launch-quality prospect list?
- Keep legacy Text Search, or move to Places API (New)?
- Category keyword strategy: are broad OR queries helping or hurting precision/cost?
- Should the per-run budget stay a safety net, or be removed once cost is deterministic?

## Pointers (current implementation)

- `packages/server/src/services/google-places.service.ts` — `searchByKeywordDetailed`
  (paging + token-based `saturated` flag), `searchCellRecursive` (shared-queue drill +
  budget), `MAX_DRILL_RESOLUTION = 9`.
- `packages/server/src/services/prospect-generation.service.ts` — orchestration, background
  run manager, `DEFAULT_MAX_API_CALLS = 8000`, `SEARCH_CONCURRENCY = 1`.
- `packages/server/src/services/h3-territory.service.ts` — territory tiling / search-center
  derivation (res-4 centers from res-7 hexes).
- Spec anchor: `.kiro/specs/31-prospect-management/`.


---

## Evaluation spike results (Nov 1, 2026)

### Source 1 — OpenStreetMap / Overpass — Erie County, NY

Throwaway Overpass query (keyless, no cap, no cost), OSM tags approximating the 3 active
categories, within Erie County (the Buffalo metro — the dense core of the WNY territory):

| Category | OSM count (Erie County only) |
|---|---|
| Beauty & Hair | 539 |
| Massage Therapy | 57 |
| Spas & Recovery Centers | 28 |
| **~total (pre cross-category dedup)** | **~624** |

- 596 unique elements, 593 named.
- **Coverage signal: strong.** One county in OSM (~624) roughly equals the entire
  10-county Google-derived total (~543 active). Contradicts the original spec assumption
  that "small businesses almost always have a Google listing" — OSM appears to find MORE.
- **Data-quality gap: notable.** Only 172/596 (~29%) have a phone; 110/596 (~18%) have a
  website. OSM finds the businesses but often lacks outreach contact fields.

**Interpretation:** confirms the hybrid hypothesis with evidence — OSM is a strong, free,
uncapped DISCOVERY source, but needs an ENRICHMENT layer (Google/Foursquare/Overture) to
fill phone/website for outreach. Supports: OSM (+Overture/Foursquare) for the complete list,
targeted enrichment for contact data.

**Caveats:** OSM tags don't map 1:1 to our categories (counts are directional); single
county, single source; not yet checked against a hand-counted ground-truth area.

### Next spike steps (pending)
- Measure **Overture** and **Foursquare** for the same county (needs DuckDB locally — bulk
  GeoParquet datasets, not simple APIs).
- Hand-count one small dense area (a few Buffalo blocks) on Google Maps to get a true recall
  denominator for all sources.
- Quantify cross-source overlap (drives de-dup difficulty).


### Source 2 — Overture Maps Places — Erie County, NY (via DuckDB on S3 GeoParquet)

Queried Overture release 2026-10-21.0 directly from S3 with DuckDB (bbox-filtered), ~6s,
free, no key, no cap. Keyword-bucketed to the 3 categories (loose matching — see caveats):

| Source (Erie County) | Businesses | Has phone | Has website |
|---|---|---|---|
| Google (all 10 counties) | ~543 | — | — |
| OSM (Erie only) | ~624 | 29% | 18% |
| **Overture (Erie only)** | **~3,973*** | **95%** | **79%** |

\* Loose keyword matching inflated this with false positives (an auto dealer, tattoo
parlors). True wellness count is lower, but even conservatively it far exceeds OSM/Google.

**Findings:**
- **Overture coverage ~6× OSM** in the same county, with vastly better contact data.
- **Every record carries a confidence score** (0–1) — a principled include/exclude lever.
- Pulled 54,424 total places in the Erie bbox in ~6s; fast enough to be practical.

**Implications for the design:**
- Overture is a strong candidate for the **discovery backbone** (not just a supplement).
- The **enrichment burden shrinks dramatically** — at 95% phone coverage, a Google Place
  Details enrichment pass drops from "~2,400 of 3,000" to maybe a few hundred gaps. Google
  becomes optional cleanup, not a core dependency — less cost, less reliance on the
  deprecating Places API.

**Caveats / to verify:**
- Replace loose keyword matching with Overture's proper `taxonomy` hierarchy for accurate
  category counts.
- Apply a confidence threshold; low-confidence entries (seen at 0.18–0.34) pad the count.
- Spot-check that phone/website values are current/correct, not merely present.
- Erie is dense metro; measure a SPARSE county too before generalizing.
- Operational model: Overture is a bulk GeoParquet dataset on S3. Querying by bbox/polygon
  via DuckDB works well; decide whether prod queries S3 live or caches a regional slice.

### Enrichment design note (from discussion)
- Plan: after cross-source de-dup, enrich ONLY prospects still missing phone/website,
  likely via Google **Place Details** (not Text Search). One lookup per gap, once per
  prospect — bounded, cheap, and far smaller now that Overture fills most contact data.

### Still pending
- Measure **Foursquare** (same county) for a third data point.
- Hand-count a small dense area for a true recall denominator.
- Quantify cross-source overlap (de-dup difficulty).


### Design principle: separate DISCOVERY from QUALIFICATION (from Exotic Tan analysis)

A key distinction surfaced while inspecting the Overture records (verified against Google
Maps ground truth):

- **Completeness** ("did we find every business in the territory?") is a **search** problem.
  Overture solves it well — e.g. "Exotic Tan" is a real Erie-area business that Overture
  found (phone, confidence 0.92) and OSM missed entirely.
- **Candidate fit** ("is this a plausible DayStream customer?") is a **targeting/qualification**
  problem, separate from search. "Exotic Tan" is real and well-documented but is NOT a good
  prospect (a single-service tanning salon isn't the ideal customer). No data source decides
  fit for us.

**Principle:** the pipeline must keep these as distinct, independently tunable layers:
1. **Discover** broadly (Overture + supplements) — wide net, no pre-judging.
2. **Filter mechanically** — territory polygon (point-in-hex), confidence threshold, de-dup.
3. **Qualify by fit** — a CONFIGURABLE ideal-customer policy: which business categories
   count as prospects, plus optional soft signals. This is where "Exotic Tan" is excluded —
   not because the data is wrong, but because it doesn't fit the target profile.

Today's engine conflates "what to search for" with "what counts as a prospect" (rigid
category keywords). Splitting them lets the target profile be tuned as a POLICY without
re-engineering discovery.

**On quality signals:** "has a website" is a reasonable soft signal of software-readiness
but NOT a hard gate — many legitimate target businesses run off a Facebook page (Exotic Tan
does), and a Facebook presence may itself be a positive (digitally engaged) signal. Treat
such signals as inputs to a tunable fit score, not rules.

**Data-quality observation:** Overture's coverage and contact data appear materially better
than OSM's (the Exotic Tan case + the aggregate 95% vs 29% phone coverage). Overture is the
leading candidate for the discovery backbone; OSM/Foursquare as supplements.


### De-dup rule: identity is NAME + LOCATION, never name alone (critical)

Found while inspecting the clean Overture Erie set: **"Advanced Care Physical Therapy"
appears 6 times with 6 different addresses.** These are 6 legitimate, distinct locations and
all 6 MUST be kept. A naive de-dup keyed on business name would collapse them to one and
silently delete 5 real businesses — a data-destroying bug, and especially bad because a
multi-location operator is potentially an IDEAL DayStream prospect.

**Requirements for the de-dup/reconcile layer:**
- Match identity on **name + address/geographic proximity** (same name AND ~same point,
  within a small radius). Same name at a different address = a DIFFERENT record — keep it.
- The de-dup's only job is to merge **the same physical location found by multiple sources**
  (e.g. Overture + OSM both have "Advanced Care @ 123 Main" → one reconciled record). It must
  NEVER collapse distinct locations of a chain.
- Inverse opportunity (for the fit/scoring layer, not de-dup): grouping by name to DETECT
  multi-location operators is useful as a POSITIVE qualification signal (more locations =
  higher-value prospect). Use name-clustering to FLAG, never to DELETE.

### Fit/qualification layer — refined (from user spot-check)

- User filtered the 2,417 clean Overture rows down to ~1,867 by removing businesses with no
  phone AND no website; spot-checks showed the removed ones were often gone or too small.
- BUT this is a ROUGH cut, not the definition: "no phone/website" correlates with
  "small/unsophisticated" but is a SOFT signal (cf. Exotic Tan — real, Facebook-only). Even
  within the 1,867, some are not ideal fits.
- Confirms: the fit policy should be a CONFIGURABLE, weighted judgment (category + soft
  signals), not a hard rule — and getting it right is the key remaining work. The search
  (discovery) is effectively solved by Overture; candidate QUALITY is the open problem.


### De-dup matching: fuzzy names + canonical addresses (from Susan Naturally example)

Real case: OSM has "Susan Naturally Day Spa featuring Susan Ciminelli"; Overture has
"Susan Naturally Day Spa" — SAME address, slightly different name strings, and the address is
spread across different field shapes (Overture: structured freeform/locality/region/postcode;
OSM: fewer/looser tags). A human sees one business; exact-string matching sees two.

Combined with the Advanced Care case, this fully specifies the matching rule:

- **Advanced Care**: same name, DIFFERENT addresses → 6 distinct businesses, do NOT merge.
- **Susan Naturally**: DIFFERENT name strings, SAME address → one business, DO merge.
- Conclusion: **location is the primary match key; name is a fuzzy confirmer.** Neither name
  alone nor exact-string matching is correct.

**Normalize phase (before matching) must:**
- Parse every source's address into a common canonical form (street / city / state / postal /
  geocoded point), reconciling the different field shapes across sources.
- Normalize names: lowercase, strip punctuation and filler ("featuring", "LLC", "the", etc.).

**Match phase:**
- Group candidates by geographic proximity first (same point within a small radius / same
  normalized address), THEN confirm with fuzzy name similarity:
  substring/containment, token overlap (e.g. Jaccard), or edit distance above a threshold.
- Only records that match on BOTH location and fuzzy-name are the same business.

**Reconcile phase (when records merge):**
- Choose the canonical name (prefer the richer/official one; keep the other as an alias).
- Field-by-field, keep the best value from each source (phone/website from whichever has it,
  highest confidence, most complete address), and record contributing sources.

These three user-found cases (Advanced Care, Exotic Tan, Susan Naturally) are excellent
real-data acceptance-test fixtures for the de-dup engine — use them as test cases.


### Cross-source comparison: OSM vs Overture (Erie County) — OSM adds little

First pass suggested 316 OSM entries were "unique" vs Overture. User spotted many were in
**Erie, PA** — my OSM Overpass pull was NOT territory-constrained and leaked a neighboring
"Erie County" / the city of Erie PA (Overture WAS region='New York' filtered, so the
comparison was unfair). Same class of bug as the Overture-Canada bbox spill.

After constraining OSM to the Erie County NY bbox:
- OSM rows: 596 raw → **357 in-territory** (239 / 40% were out-of-area — mostly Erie PA)
- Matched to Overture: 280
- **OSM-only: 77** (down from 316), and that 77 is a soft upper bound (false non-matches
  from missing coords; some are low-quality/stale OSM entries, not good prospects).

**Implications:**
- **Overture appears largely sufficient on its own** (~2,417 clean NY businesses; OSM adds
  at most a few dozen genuine quality uniques for this county). This weakens the case for a
  full multi-source hybrid + cross-source de-dup, and favors a simpler
  **Overture-primary design** (Overture discovery + light Google Place Details enrichment
  for the ~4% missing phones), with OSM/Foursquare optional/deferred.
- **The territory-POLYGON filter is central and non-negotiable.** Both the Overture-Canada
  and OSM-Erie-PA spills were the same bug: a bbox is not a territory. Production must
  point-in-polygon filter every source against the real H3 territory hexes (the current
  system already does this; the spikes cut the corner).
- Matching quality is the whole ballgame: the fuzzy matcher still mis-matched
  "Grand Island Physical Therapy" ≈ "Island Aesthetics" (token overlap too loose). Tuning
  thresholds + using address, not just name+proximity, is required.

**Open design question:** multi-source hybrid vs. Overture-primary? Evidence so far leans
Overture-primary (simpler, and OSM's marginal contribution is small once territory-filtered).
Decide before building. A sparse-county check and a Foursquare data point would confirm.


### Sparse-county test — Overture holds up rurally (Wyoming County, NY)

Tested whether Overture degrades in a genuinely rural county (Wyoming County, NY — ~40k
population, small towns, no metro; one of the 10 US-NY-1 counties).

**Overture clean (NY + taxonomy + conf>=0.5): 46 businesses, 93% phone, 76% website.**
Sample was clearly legitimate — real salons/barbers/massage/spa in Warsaw & Varysburg
(the actual towns), mostly high confidence (0.92+).

- Density scaling looks realistic: Erie (metro) ~2,417 vs Wyoming (rural) ~46 — a ~50x
  spread matching real population density, i.e. the data tracks reality, not noise.
- Contact-data coverage barely dropped from the dense case (93%/76% vs 96%/79%).
- **Conclusion: Overture does NOT collapse in rural areas** — it returns a believable,
  well-contactable set. This was the main risk to "Overture is sufficient"; it held.
- (OSM comparison skipped — public Overpass server returned transient 502s; not worth
  retrying since Erie already showed OSM adds little once territory-filtered.)

### Evaluation conclusion (recommendation)

Evidence across dense + sparse counties supports an **Overture-primary design**, not a
full multi-source hybrid:
- Overture: strong coverage + ~95% phone / ~78% website, confidence-scored, free, uncapped,
  deterministic, holds up dense AND rural.
- OSM: adds only a handful of genuine territory-filtered uniques; not worth the cross-source
  de-dup complexity as a launch requirement (can be revisited).
- Foursquare: now behind an auth portal (not keyless); skipped — low expected marginal value.
- Google: demote to OPTIONAL enrichment (Place Details) for the ~4-7% missing phone/website,
  OR drop entirely given Overture's contact coverage is already high.

**Remaining work is in filtering/qualification + light de-dup, not discovery:**
1. Territory-POLYGON filter (point-in-H3-hex) on Overture results — non-negotiable (fixes
   the Canada/PA bbox spills).
2. Fit/qualification layer — configurable ideal-customer policy (category + soft signals);
   the real product decision.
3. De-dup — within Overture + against existing prospects; identity = name+location, keep
   multi-location chains, fuzzy name match. Much simpler than cross-source de-dup.
4. Optional Google Place-Details enrichment only for remaining contact gaps.


### Second rural data point — Cattaraugus County, NY (strongest result)

| County | Google (live app) | Overture (clean) | Multiple | Notes |
|---|---|---|---|---|
| Erie (metro) | ~543 (all 10 counties) | ~2,417 | n/a (not apples-to-apples) | |
| Cattaraugus (rural) | **29** | **171** | ~6x | Overture contained essentially ALL of Google's 29 |
| Wyoming (rural) | 8 | 46 | ~6x | Overture missed 1 genuine gap (Body Wisdom); 2 others were my bbox clipping |

- Cattaraugus: 171 clean (97% phone, 67% website); 40 PA-border records correctly dropped
  by the NY filter.
- **Overture ≈ superset of the current Google search here** — user confirmed most/all of the
  29 app-found businesses appear in the Overture 171.
- The ~6x coverage multiple is now **consistent across metro + two rural counties**.

**Verdict:** the evaluation's core question is answered. Overture reliably finds ~5-6x the
current Google search, with high contact-data coverage, and nearly-superset behavior. Its
gaps are a small, inconsistent tail (optional gap-fill from a secondary source, not a
completeness requirement). Proceed with an Overture-primary design. Discovery is solved; the
remaining work is the territory-polygon filter, the configurable fit/qualification layer,
and light within-source de-dup (+ optional Google Place Details enrichment for contact gaps).
