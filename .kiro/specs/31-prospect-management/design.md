# Phase 31: Prospect Management — Design Document (Overture Redesign)

**Date**: November 1, 2026
**Status**: 🎨 Design Phase
**Dependencies**: Phase 03 (Core Platform), existing territory-definition (H3 tiling)

---

## Overview

This design re-engineers prospect **discovery** to use **Overture Maps Places** as the
primary data source, replacing the Google Places text-search + recursive drill-down engine.
It is motivated by a multi-county evaluation (see `docs/PROSPECT_SEARCH_REDESIGN_NOTES.md`)
showing Overture returns ~5–6× the businesses the Google approach found, with ~95%+ phone
coverage, deterministic results, no result cap, and free/uncapped access — while the Google
Places API is both unreliable (flaky saturation signal) and on a deprecation path.

The **territory-definition workflow is unchanged** (resolve area → boundary polygon → H3
tiling → population filter). Only discovery, filtering, de-dup, and scoring change.

Two concepts are introduced as first-class, DayStream-owned capabilities:
- a **Fit Score** — DayStream's own judgment of how good a DayStream customer a business
  would be (distinct from Overture's data-quality confidence), and
- **Territory Valuation** — an aggregate of fit across a territory, supporting the
  franchise/territory business model.

---

## Table of Contents

1. [Architecture: the discovery funnel](#1-architecture-the-discovery-funnel)
2. [Data source & access (Overture via DuckDB)](#2-data-source--access-overture-via-duckdb)
3. [Query layer (geography + category)](#3-query-layer-geography--category)
4. [Post-query filtering (territory polygon, local)](#4-post-query-filtering-territory-polygon-local)
5. [De-duplication & reconciliation](#5-de-duplication--reconciliation)
6. [Category mapping (config)](#6-category-mapping-config)
7. [Fit signals, Fit Score, and Territory Valuation](#7-fit-signals-fit-score-and-territory-valuation)
8. [Data model changes](#8-data-model-changes)
9. [Optional enrichment (contact gaps)](#9-optional-enrichment-contact-gaps)
10. [Background job, status, cost](#10-background-job-status-cost)
11. [Migration & rollout (additive, flagged)](#11-migration--rollout-additive-flagged)
12. [Testing](#12-testing)
13. [Open questions](#13-open-questions)

---

## 1. Architecture: the discovery funnel

Generation runs as a funnel. Each stage is deliberately placed either in the data-fetch
query (only what is structurally necessary) or in app code (everything judgmental/tunable):

```
[1] DuckDB query against Overture S3        → geography (bbox) + category          (fetch)
[2] Precise territory filter                 → point-in-H3-polygon (drop bbox spill) (app)
[3] De-duplicate & reconcile                 → name + location identity             (app)
[4] Compute fit signals + Fit Score          → store raw signals; score each        (app)
[5] Persist prospects (NOTHING discarded)    → store all, with confidence + signals  (db)
[6] (optional) enrich contact gaps via Google Place Details                          (app)
[7] Aggregate → Territory Valuation          → fit-tier counts per territory         (db/app)
```

Key principles:
- **Geography and category** are pushed INTO the query (performance + payload).
- **Everything judgmental** — precise territory boundary, Overture confidence threshold,
  fit scoring, qualification — happens in app code where it is observable and tunable.
- **Nothing is discarded.** Records that fail confidence/fit are stored and flagged, not
  deleted, so thresholds can be re-tuned locally without re-querying Overture.

---

## 2. Data source & access (Overture via DuckDB)

- **Source**: Overture Maps Places theme, public GeoParquet on S3
  (`s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/*`). Global
  coverage (verified: US WNY counties + Mallorca, Spain). Free, open license, no API key,
  no result cap, updated ~monthly.
- **Access engine**: **DuckDB embedded in the server** (the `duckdb` npm package), using the
  `httpfs` + `spatial` extensions to query the remote Parquet directly via HTTP range
  requests (predicate pushdown on `bbox` keeps it to a few seconds / territory).
  - DuckDB is an in-process query engine (akin to SQLite), NOT a managed service. Chosen
    over AWS Athena for: free, no per-query cost, no AWS setup, portable (works locally and
    anywhere). Tradeoff: a **native binary dependency** in the server/deploy — must be
    accounted for in the AWS deployment image (noted in `docs/AWS_DEPLOYMENT_AND_COSTS.md`).
  - The Overture release id is config (not hardcoded) so it can be advanced as Overture
    publishes new releases.
- **Access model**: **on-demand, per-territory.** A query is run when a territory's prospect
  list is generated (a few times/week, rarely re-run per territory). No standing cached
  regional dataset and no refresh pipeline — data is fetched fresh at generation time.

---

## 3. Query layer (geography + category)

The DuckDB query against Overture applies ONLY the two filters that are structurally
necessary; everything else is deferred to app code.

- **Geography**: a bounding box derived from the territory's H3 hexes (min/max lat/lng).
  Required — `bbox` predicate pushdown is what makes the query fast. The bbox is a
  rectangle and WILL over-select beyond the true territory (handled in §4).
- **Category**: the tenant's selected categories, mapped to a curated set of Overture
  taxonomy / basic_category values (see §6). Kept slightly BROAD at this layer — better to
  over-fetch and refine in app than to silently exclude at the source.
- **NOT filtered here**: Overture confidence (deliberately — we do not understand what drives
  it, so we do not gate the fetch on it; §7), territory polygon, fit.

Fields selected: id, name, taxonomy.primary, basic_category, confidence, full address parts,
phones, websites, emails/socials (if present), lat/lng, and Overture's source list.

---

## 4. Post-query filtering (territory polygon, local)

Applied in app code to the fetched candidate set:

- **Precise territory membership**: for each candidate, compute its H3 cell at the territory
  resolution (res 7) and keep it only if that cell is in the tenant's stored territory hexes.
  This removes the bounding-box spillover (e.g. Canada beyond the Niagara River, Erie PA
  across the state line) that caused false inclusions in evaluation.
- **Confidence**: Overture's confidence is retained on every record and used as a tunable
  local signal/flag — NEVER as a hard fetch-time filter. The threshold for "active" vs
  "held" is a local, adjustable setting so its effect can be studied and changed without
  re-querying.
- **Contact-data completeness (operator-selectable)**: evaluation showed many records lack a
  phone and/or website. This is handled as a **post-query, UI-selectable inclusion filter**,
  NOT a query-time exclusion — for the same reason as confidence: excluding at fetch time
  would discard records we want to retain and learn from (cf. Exotic Tan: a real business
  with no website). The operator chooses per run (and/or via a saved default):
  - `Include all`
  - `Require phone OR website` — **default** (weeds out the thinnest listings while keeping
    anything reachable)
  - `Require phone AND website`
  Applied as a reversible classification flag over STORED records (not a delete), so changing
  the setting re-classifies instantly with no re-query. The payload is tiny (~7,500
  rows/territory ≈ ~2 MB), so there is no meaningful transfer benefit to moving this into the
  query — and doing so would cost the learning data. Keep it post-query.

---

## 5. De-duplication & reconciliation

De-dup identity is **name + location**, never name alone. Validated against three real cases
from the evaluation (use as acceptance-test fixtures):

- **Advanced Care Physical Therapy** — same name, 6 DIFFERENT addresses → 6 distinct
  businesses, all kept. (Multi-location chains must be preserved.)
- **Susan Naturally Day Spa** vs **"...featuring Susan Ciminelli"** — different name strings,
  SAME address → one business, merged.
- **Grand Island Physical Therapy** vs **Island Aesthetics** — near each other, share a
  token, but DIFFERENT businesses → not merged (guards against over-loose name matching).

Algorithm:
1. **Normalize**: canonicalize addresses to a common form (street/city/region/postal/point);
   normalize names (lowercase, strip punctuation + filler like "featuring"/"LLC"/"the").
2. **Match**: group by geographic proximity (within a small radius / same normalized
   address), THEN confirm with fuzzy name similarity (containment or token overlap above a
   tuned threshold). Same business only if BOTH location and name agree.
3. **Reconcile** (when merging): choose canonical name (prefer richer/official, keep other as
   alias); field-by-field keep best value; record contributing source(s).

Scope: because evaluation showed supplementary sources add little once territory-filtered
(Overture ≈ superset of the current Google results), v1 de-dup operates **within Overture**
and **against the tenant's existing prospects** (so re-runs update rather than duplicate).
Cross-source de-dup is NOT required for v1.

---

## 6. Category mapping (config)

- A curated mapping from each DayStream UI category (e.g. "Spas & Recovery Centers",
  "Massage Therapy", "Beauty & Hair") to a set of **Overture taxonomy / basic_category
  values** — NOT loose keyword/name regex (which, in evaluation, wrongly pulled in auto
  dealers and tattoo parlors).
- Stored as configuration (editable by system admins), so categories and their Overture
  mappings evolve without code changes. Mirrors today's `prp_category_mappings` but mapping
  to Overture taxonomy instead of Google search strings.
- The query-layer category filter uses this mapping (kept slightly broad); precise
  category/fit judgment happens in the fit layer (§7).

---

## 7. Fit signals, Fit Score, and Territory Valuation

Two scores, kept strictly separate:

- **Overture confidence** = "is this record real/accurate?" (source data-quality signal; an
  INPUT we may use, not something we own).
- **DayStream Fit Score** = "how good a DayStream CUSTOMER would this business be?"
  (DayStream-owned, 0–100, the output that matters). Example: a tanning salon may have high
  Overture confidence but a low Fit Score.

### Fit signals (stored raw, never discarded)
Per prospect, persist the inputs a fit model uses: matched category, Overture confidence,
has-phone, has-website, has-social (e.g. Facebook), multi-location-operator flag (derived by
name-clustering across the territory), review count/rating (if present), address
completeness. Storing raw signals is what enables later learning.

Note the dual role of contact-completeness (has-phone/has-website): it is BOTH (a) a stored
fit signal feeding the Fit Score here, AND (b) the operator-selectable post-query inclusion
filter described in §4. These are distinct mechanisms over the SAME stored signals — the
score uses them to rank; the operator filter uses them to include/hold. Neither is a
query-time exclusion, so no record is lost.

### Fit Score — v1 (transparent, configurable, NOT an "ideal profile" yet)
A simple, readable weighted rule producing 0–100 (weights stored as config). Illustrative
starting rubric (to be tuned with the user):
- strong-fit category (recovery/spa/physio/multi-service wellness) vs weak (barber/tanning)
- has website (soft signal of software-readiness — a factor, NOT a gate; cf. Exotic Tan
  which is real but runs off Facebook only)
- multi-location operator (positive — higher potential value)
- contactability (phone/website/social present)
Deliberately a HYPOTHESIS, not a learned model — we don't yet have conversion ground truth.

### Learning loop (design for it now, build the model later)
Prospects already carry lifecycle outcomes (contacted → demo → signed → declined). Because
raw signals are stored, accumulated outcomes become training data to refine the Fit Score
weights from REAL conversions over time. v1 ships a reasonable guess; outcomes sharpen it.

### Territory Valuation (descriptive first, predictive later)
Aggregate Fit Score across a territory into a descriptive metric: prospect counts by fit
tier (e.g. strong / moderate / weak) and totals. Supports the franchise model (set
expectations, compare/rank territories). v1 is explicitly DESCRIPTIVE (counts/averages),
NOT an authoritative "territory is worth $X" — that requires conversion data we don't have
yet. Predictive valuation is a future enhancement fed by the learning loop.

---

## 8. Data model changes

Extend the prospect storage (migration, next available NNN):
- `source` supports `'overture'` (alongside existing `'api'`/`'manual'`).
- `external_id` (Overture place id) for stable dedup/update on re-run.
- `confidence` (NUMERIC) — Overture's score, stored, used locally.
- fit signal columns (or a JSONB `fit_signals`) + `fit_score` (INTEGER 0–100) +
  `fit_tier` (derived) + `included` / status flag (held vs active — reversible, not delete).
- Keep contact fields (phone, website, social), address parts, lat/lng.
- Config: category→Overture-taxonomy mapping; fit-score weights; confidence threshold;
  Overture release id. (Reuse `sys_system_configurations` / `prp_category_mappings`.)

All stored; nothing discarded — thresholds/fit are reversible classification over stored data.

---

## 9. Optional enrichment (contact gaps)

- Overture already provides ~95% phone / ~78% website, so the enrichment need is small.
- For the residual gap only, optionally call **Google Place Details** (NOT Text Search) to
  fill a missing phone/website for a specific prospect — one lookup per gap, once per
  prospect, bounded and cheap. Subject to the Google daily quota already in place.
- Enrichment is OPTIONAL and may be deferred; design keeps Google off the critical path.

---

## 10. Background job, status, cost

- Generation remains a **background job** (returns immediately; UI polls status) — reuse the
  existing run-status pattern.
- Per-territory Overture query is ~a few seconds (evaluation: ~6s for a dense county) and
  runs a few times/week — well within tolerance for a background task.
- **Cost**: Overture query is free (no per-call charge, no cap). Optional Google enrichment
  is the only metered cost and is bounded by the existing Places daily quota.
- Retain a per-run safety timeout on the DuckDB query so a stalled S3 read can't hang a run.

---

## 11. Migration & rollout (additive, flagged)

- Build the Overture path **additively, behind a feature flag**, alongside the existing
  Google engine — do not rip out the working engine until the new path is proven
  ("don't break what works").
- Validate the new path on known territories (WNY counties, Mallorca) against the evaluation
  numbers before switching the default.
- Once validated, flip the default to Overture; retain Google only as optional enrichment.

---

## 12. Testing

- **Stubbed data fixtures** — every bug in the old engine hid behind a live vendor's
  non-determinism. The de-dup and fit logic MUST be unit-tested against fixtures, including
  the three real cases: Advanced Care (keep 6), Susan Naturally (merge), Grand Island PT vs
  Island Aesthetics (don't merge).
- Territory-polygon filter test: a known out-of-territory point (Canada / Erie PA) is
  excluded; an in-territory edge town (e.g. Arcade in Wyoming County) is included.
- Fit-score tests: known inputs → expected score/tier; Exotic Tan → found but low fit.
- A ground-truth recall check on at least one dense and one sparse territory.

---

## 13. Open questions

- Exact de-dup thresholds (proximity radius, name-similarity cutoff) — tune against fixtures.
- v1 Fit Score weights — to be set with the user; start transparent and simple.
- Confidence threshold default for "active" vs "held" — a learn-locally value.
- Whether to keep OSM as an optional gap-fill source later (evaluation: low marginal value;
  deferred, not required for v1).
- Production DuckDB packaging in the AWS image (native binary) — coordinate with deployment.
- Multi-location detection method (name-clustering within a territory) — precision tuning.

---

**Status**: 🎨 Design Phase
**Dependencies**: Phase 03 (Core Platform), existing H3 territory definition
**Supersedes**: the Google Places text-search + recursive drill-down discovery approach
