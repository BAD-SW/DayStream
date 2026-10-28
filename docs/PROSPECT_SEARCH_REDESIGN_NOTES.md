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
