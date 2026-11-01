# Google API Cost Controls & Incident Notes

**Last Updated**: November 1, 2026
**Purpose**: Record how Google API spend is protected, which APIs DayStream uses, and the
lessons from the October runaway — so this isn't re-learned the hard way.

---

## Google APIs DayStream calls

| API | Used for | Where | Cost risk |
|---|---|---|---|
| **Places API (Legacy)** (`places-backend.googleapis.com`) | Prospect search — Text Search + recursive drill-down | Server-side (prospect generation) | **High** — this is the runaway culprit |
| **Maps JavaScript API** | Rendering the Territory picker + Coverage maps | Browser-side | Low |
| **Geocoding API** | Resolving a typed place name/postal code when defining a territory | Server-side (territory setup) | Low–moderate |

All three currently use the **same API key** (`config_data.google_places` in
`sys_system_configurations`, category `api_keys`). See "Open follow-ups" below.

---

## Cost-protection layers (defense in depth)

1. **Google Places API daily quota — 3,000 requests/day** *(authoritative external guardrail)*
   - Set in Cloud Console → APIs & Services → Places API (Legacy) → Quotas & System Limits.
   - A legitimate full run is ~160 calls (WNY, 3 categories); 3,000/day is a comfortable
     ceiling that still hard-stops a runaway. Also keeps a day's use near the 10k/mo free tier.
   - (Optional) Requests-per-minute can be lowered (~300) as a burst guard; quota enforcement
     has some latency, so a tight per-minute limit reduces overshoot.
2. **App-level per-run API-call budget — 8,000** (`DEFAULT_MAX_API_CALLS` in
   `prospect-generation.service.ts`). Enforced via a shared work-queue with per-call budget
   reservation; proven in isolated tests to hold within ~18 calls. NOTE: not yet exercised by
   a real dense production run — the Google quota above is the trusted backstop.
3. **Billing budget alert — ~$2** (Cloud Console → Billing → Budgets & alerts). Alerts only,
   does NOT stop spend; expect it to fire easily. Early-warning tripwire.
4. *(Optional, not yet set)* **Geocoding API daily quota** — a small cap (e.g. 500/day) is
   reasonable insurance; territory setup never needs more.

---

## Incident: October Hawaii runaway (post-mortem)

- A prospect-generation run for the Hawaii (US-HI-1) territory consumed **~23,000 Places
  API calls** and pushed the month ~$50 over the free tier.
- **Why the app-level cap didn't save it:** at the time the budget was 2,000 AND its
  enforcement was broken — the recursive drill spawned a fresh concurrency pool at every
  level, so thousands of calls were in flight before the budget check tripped. Fixed
  afterward (single shared work-queue + reserve-before-call); overshoot now bounded to
  ~`DRILL_CONCURRENCY × 3` calls.
- **Root lesson:** never let the only thing between you and a surprise bill be a cap inside
  the same code that generates the calls. The **Google-side daily quota** is the guardrail
  that does not depend on application logic being correct. It is now in place.
- Separately, this exposed that the prospect search over-drills on a flaky saturation signal
  (see `PROSPECT_SEARCH_REDESIGN_NOTES.md`). The quota caps the blast radius; it does not
  fix the search quality.

## Incident: Maps "BillingNotEnabledMapError" (resolved)

- Both maps showed "This page can't load Google Maps correctly" with a dev watermark.
- Cause: the project's billing account had lapsed/was inactive (likely tied to the overage).
  The browser console error was `BillingNotEnabledMapError` — a billing problem, NOT a
  Places call-budget / quota problem (the monthly free-call reset did not fix it).
- Fix: upgraded/linked an active billing account to the project; a hard refresh
  (Ctrl+Shift+R) cleared the cached Maps script and the maps rendered.

---

## Open follow-ups (not yet done)

- **Restrict the API key.** The single shared key works for any enabled API from anywhere.
  Quotas cap *volume*, but a leaked unrestricted key could still burn the daily quota or hit
  other enabled APIs. Restrict the key to the APIs actually used (Places Legacy, Maps JS,
  Geocoding) and to known referrers/IPs. (On the security hardening checklist.)
- **Consider splitting keys**: a server key (Places/Geocoding, IP-restricted) and a browser
  key (Maps JS, HTTP-referrer-restricted). Reduces blast radius and is cleaner security.
- **Legacy deprecation**: Places API (Legacy) is marked Legacy by Google and will eventually
  retire; the successor (Places API New) caps at 20 results/request. Revisit quotas and the
  search design when that migration is forced. (See redesign notes.)
