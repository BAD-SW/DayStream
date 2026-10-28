# Phase 50: Data Migration

**Status**: 📋 Planned
**Dependencies**: Phase 46 (People Foundation), Phase 05 (Customer Management), Phase 10 (Payment Platform), business setup (services/staff), Phase 08 (Memberships), Phase 28/packages
**Estimated Duration**: 3-4 weeks (three waves)

---

## Documents

- **[requirements.md](./requirements.md)** - What the migration experience must do, as user stories and acceptance criteria
- **[design.md](./design.md)** - How it works: one engine, per-entity landing, the locked import order
- **[tasks.md](./tasks.md)** - Implementation task breakdown, grouped into three shippable waves

---

## Overview

When a business switches to DayStream, their existing data is the single biggest switching cost. If moving it in feels like a project, a mature business may decide the pain outweighs the benefit and stay where they are — or pick a competitor. This phase makes bringing a business's customer world across easy enough that migration is never the reason a business walks away.

The whole onboarding — setup plus data — should fit in about a week with tenant-owner assistance. A business goes live after setup, then migrates their data over the following days. So migration runs against a **live, operating** business and must be **safely repeatable**: import, assess, fix the few rows that didn't, run again — never "fix your whole file and start over."

Migration covers the customer and everything attached to them: customers, their payment methods, memberships, packages, appointments (future and past), account balances, and transaction history. Each is its own simple flow — upload a file (CSV or Excel), the system auto-detects columns and auto-matches references, you run a trial to see exactly what would happen, then commit. A business imports only the parts it needs; a step with no downstream dependency can be skipped.

**Core principles**:
- One shared, forgiving import engine; a separate labelled flow per entity
- The software does the hard part (detection, matching); the owner confirms, never configures
- A trial assessment shows the full outcome before anything is written
- Safe to re-run over days against a live business — the identity service prevents duplicates
- **No emails are ever sent as a result of an import**
- Tucked under Business Setup (not the main menu); the same capability is available to the tenant owner per business
- Live state (memberships, balances, future bookings) lands in the real system; history (past appointments, past transactions) lands on the customer timeline only — never the financial ledger

---

**Last Updated**: July 6, 2026
