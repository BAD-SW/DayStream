# DayStream — AWS Deployment & Hosting Cost Estimate

**Purpose:** Hosting-cost input for the business plan. Describes the AWS services required to run DayStream, for a **Production** and a **Development** environment, with Production costed at three growth tiers (Initial, Moderate, Significant).

**Status:** Planning estimate. Figures are 2026 AWS on-demand list prices (US region), rounded. Real bills vary with usage, region, and commitments (see *Cost-reduction levers*). Treat these as budgeting ranges, not quotes.

**Last updated:** July 2026

---

## 1. What DayStream actually runs (and why it shapes the cost)

The estimate is built from the real architecture, not a generic SaaS template:

- **One Express/TypeScript API process** (monorepo `packages/server`). Per ADR-002 it is deliberately **not serverless** — it runs long-lived background work.
- **In-process background workers**: a job scheduler (`startJobScheduler` — daily billing, dunning, lifecycle, reporting) and an email-queue drainer (`startEmailQueueScheduler`), both running on timers inside the API process. **Consequence: the API must be always-on**; we cannot scale it to zero.
- **PostgreSQL** with row-level tenancy (single pool, RLS, raw SQL). This is the system of record and the most important component to size correctly → **Amazon RDS for PostgreSQL**.
- **Static React/Vite frontend** (`packages/client`) → served as static files from **S3 + CloudFront** (cheap, scales for free).
- **File/image handling**: `multer` uploads, `sharp` image processing, `pdfkit` PDF generation; the storage service already has an **S3** backend → **Amazon S3**.
- **Transactional email** via `nodemailer` (SMTP) → **Amazon SES**.
- **Payments** via **Stripe** (external; Stripe's own fees are a cost of revenue, not hosting — see *Excluded*).
- **Encryption, JWT auth, audit logging** — all in-app; no managed auth service required (ADR-005 leans custom JWT).

**Key sizing driver:** DayStream is a multi-tenant monolith whose load scales with (a) number of businesses/tenants and (b) transaction/booking volume. The DB and the API compute are the two lines that grow; most other services grow slowly.

---

## 2. Target architecture (both environments)

```
                        ┌─────────────────────────────┐
         Internet ──────▶  CloudFront (CDN)            │  ← static React app + cached assets
                        └──────────────┬──────────────┘
                                       │ /api/*
                        ┌──────────────▼──────────────┐
                        │  Application Load Balancer   │  ← TLS termination, health checks
                        └──────────────┬──────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │  ECS Fargate service         │  ← Express API + in-process schedulers
                        │  (1–N tasks, always-on)      │     (job scheduler, email drainer)
                        └───────┬───────────────┬──────┘
                                │               │
                 ┌──────────────▼───┐   ┌───────▼────────────┐
                 │ RDS PostgreSQL   │   │ ElastiCache (Redis)│  ← sessions/rate-limit/cache
                 │ (Multi-AZ, prod) │   │ (optional at start)│
                 └──────────────────┘   └────────────────────┘

   Supporting: S3 (uploads + frontend + build artifacts), SES (email), Secrets Manager,
   KMS (encryption keys), CloudWatch (logs/metrics/alarms), ECR (container images),
   Route 53 (DNS), automated backups/snapshots.

   External to AWS: GitHub Actions (CI/CD), Stripe (payments), OAuth IdPs
   (Google/Facebook/Apple), SMS provider (MFA codes).
```

> **Requirements reconciled:** this architecture is cross-checked against specs **00 (Infrastructure)**, **01 (CI/CD)**, and **02 (Security & Compliance)**. Phase 00 is local-first (no AWS mandate of its own). Phase 01 adds **GitHub Actions CI/CD**, versioned **build artifacts**, and an in-app **Update Manager that snapshots the DB before every update** (reinforcing backup storage) with maintenance-mode + rollback. Phase 02 adds the security/compliance cost drivers below: **KMS** (AES-256 field encryption, separate key storage, key rotation, encrypted backups — Req 6), **SMS for MFA** (Req 3, a transactional/always-on SMS cost distinct from marketing SMS), **≥1-year append-only audit log retention** (Req 9 → storage growth), **rate limiting across tasks** (Req 10 → reinforces the Redis line), and a **pre-launch penetration test** (Req 12 → a one-time professional-services cost, see §8a). GDPR (Req 8) may push the region to **EU** if Spain/EU is the launch market — see §10.

**Why ECS Fargate (not EC2, not Lambda):** no server management, right-sized containers, scales by adding tasks as tenants grow, and supports the always-on background workers Lambda can't. EC2 would be marginally cheaper at steady state but adds patching/ops burden for a small team.

**Why RDS (not Aurora) initially:** RDS PostgreSQL is cheaper and simpler at low-to-moderate scale. Aurora becomes attractive at the Significant tier (better scaling, read replicas) and is noted there as an option.

---

## 3. Development environment

Dev is deliberately minimal — single-AZ, smallest instances, no redundancy, can tolerate downtime. It mirrors prod's shape so deploys are representative, but at ~1/5 the cost. **Email is a real sending service**, not a local stub: the hosted dev environment sends genuine email to real recipients via **SES in production access** (not the sandbox). Ethereal is for *local* development only; it has no place in a hosted environment.

| Service | Dev configuration | Est. $/month |
|---|---|---|
| ECS Fargate (API) | 1 task, 0.5 vCPU / 1 GB, always-on | ~$18 |
| RDS PostgreSQL | db.t4g.micro, single-AZ, 20 GB | ~$15 |
| Application Load Balancer | 1 ALB (shared dev) | ~$18 |
| S3 (uploads + frontend) | low volume | ~$2 |
| CloudFront | low traffic (free-tier covers much) | ~$1 |
| SES (real email, production access) | verified domain + SPF/DKIM/DMARC; low volume to real inboxes | ~$3 |
| CloudWatch logs/metrics | low retention | ~$5 |
| Secrets Manager | ~5 secrets | ~$3 |
| KMS | 1–2 keys (field encryption, backups) | ~$2 |
| ECR (image storage) | a few images | ~$1 |
| Data transfer | low | ~$2 |
| **Development total** | | **≈ $70 / month** |

> **Email in hosted environments:** both Dev and Prod use **Amazon SES with production access** so emails reach legitimate addresses. Leaving the SES sandbox is a one-time AWS request, and real-recipient delivery requires a **verified sending domain with SPF, DKIM, and DMARC** DNS records (the same deliverability setup noted in the payment-platform spec). For dev, a separate sending subdomain (e.g. `mail-dev.daystream.app`) is recommended so dev traffic never affects the production domain's sender reputation. CI/CD (GitHub Actions) and SMS/MFA are shared across environments and accounted once in §8/§8a.

> Dev can be cut further (~$35/mo) by running the API on Fargate only during work hours via a scheduled scale-to-zero, and by skipping the dedicated ALB (expose the task directly in a non-public dev setup). Kept always-on here for simplicity.

---

## 4. Production cost — mapped to the year-one growth plan

Production is costed in **three phases that match the planned business-count ramp**, so hosting cost maps directly to the growth milestones in the business plan rather than to abstract size bands:

| Phase | Timing | Target businesses |
|---|---|---|
| Phase A | Months 1–3 | ~50 |
| Phase B | Months 4–8 | ~500 |
| Phase C | Months 9–12 | ~2,000 |

Every phase runs the same **resilient shape** — Multi-AZ database and ≥2 API tasks — from day one, because this is real customer money and bookings; we don't trade redundancy for a few dollars. What grows across phases is instance size, task count, the database class, caching, and usage-driven lines (email, SMS, data transfer). Prospect data (the CRM cultivates up to ~1,000 potential businesses per territory → on the order of ~20k lightweight rows by year-end) rides along in the same database and is included in the sizing.

---

### Phase A — Months 1–3 (~50 businesses)

Trivial load; cost is dominated by the always-on Multi-AZ baseline, not by usage. This is effectively the production floor.

| Service | Phase A configuration | Est. $/month |
|---|---|---|
| ECS Fargate (API) | 2 tasks × 1 vCPU / 2 GB, always-on (HA) | ~$70 |
| RDS PostgreSQL | db.t4g.medium, **Multi-AZ**, 50 GB gp3 | ~$110 |
| RDS backups / snapshots | small | ~$5 |
| Application Load Balancer | 1 ALB | ~$20 |
| ElastiCache (Redis) | cache.t4g.micro (rate-limit / session) | ~$12 |
| S3 (uploads + frontend) | low volume | ~$5 |
| CloudFront | low–moderate traffic | ~$8 |
| SES | low volume, real recipients (prod access) | ~$5 |
| CloudWatch (logs/metrics/alarms) | standard retention | ~$20 |
| Secrets Manager / KMS | | ~$10 |
| SMS for MFA | low (owner/manager sign-ins) | ~$8 |
| ECR / Route 53 | | ~$5 |
| Data transfer out | low | ~$12 |
| **Phase A total** | | **≈ $290 / month** |

> **Plan figure: ~$280–$320/month** for months 1–3.

---

### Phase B — Months 4–8 (~500 businesses)

Real but modest load. Add a 3rd API task, bump the cache, turn on WAF, and grow the usage-driven lines; the db.t4g.medium still holds 500 small-to-mid businesses comfortably (step to a larger class only if metrics demand it).

| Service | Phase B configuration | Est. $/month |
|---|---|---|
| ECS Fargate (API) | 3 tasks × 1 vCPU / 2 GB, auto-scaling | ~$105 |
| RDS PostgreSQL | db.t4g.medium (→ db.t4g.large if needed), **Multi-AZ**, 100 GB gp3 | ~$130 |
| RDS backups / PITR | | ~$12 |
| Application Load Balancer | 1 ALB | ~$22 |
| ElastiCache (Redis) | cache.t4g.small | ~$23 |
| S3 | growing uploads + docs | ~$10 |
| CloudFront | moderate traffic | ~$18 |
| SES | ~100–200k emails/mo | ~$20 |
| CloudWatch | more logs/metrics/alarms | ~$30 |
| Secrets Manager / KMS | | ~$12 |
| SMS for MFA | staff MFA across ~500 businesses | ~$18 |
| WAF | managed rules | ~$25 |
| ECR / Route 53 | | ~$6 |
| Data transfer out | moderate | ~$30 |
| **Phase B total** | | **≈ $460 / month** |

> **Plan figure: ~$420–$500/month** for months 4–8.

---

### Phase C — Months 9–12 (~2,000 businesses)

This is the step-up: ~2,000 businesses (plus ~20k prospects, higher booking/payment/email volume, more concurrent staff) needs the **memory-optimized database** and a **read replica** to offload reporting and the Query Editor, plus an auto-scaling API fleet.

| Service | Phase C configuration | Est. $/month |
|---|---|---|
| ECS Fargate (API) | 4 tasks × 1 vCPU / 2 GB, auto-scaling | ~$140 |
| RDS PostgreSQL | db.m6g.large, **Multi-AZ**, 200 GB gp3 | ~$280 |
| RDS read replica | 1 × db.m6g.large (reporting / Query Editor offload) | ~$140 |
| RDS backups / PITR | extended retention | ~$25 |
| Application Load Balancer | 1 ALB, higher LCU | ~$30 |
| ElastiCache (Redis) | cache.t4g.small (→ m6g if needed) | ~$25 |
| S3 | hundreds of GB + requests | ~$20 |
| CloudFront | higher traffic | ~$35 |
| SES | ~400–800k emails/mo (receipts, reminders, dunning across ~2k businesses) | ~$55 |
| CloudWatch | more logs/metrics/alarms | ~$50 |
| Secrets Manager / KMS | | ~$15 |
| SMS for MFA | staff MFA across ~2k businesses | ~$45 |
| WAF | managed rules | ~$25 |
| ECR / Route 53 | | ~$6 |
| Data transfer out | higher | ~$60 |
| **Phase C total** | | **≈ $930 / month** |

> **Plan figure — month-12 exit run-rate: ~$880–$1,000/month.**

---

## 5. Beyond year one — mature growth

Past 2,000 businesses (deeper territory penetration, larger businesses, higher transaction volume), the platform hardens: an auto-scaling API fleet, a larger database (db.r6g.xlarge Multi-AZ or Aurora) with multiple read replicas, and reserved-capacity commitments to cut cost. OpenSearch is optional if full-text search is adopted.

| Service | Mature configuration | Est. $/month (on-demand) |
|---|---|---|
| ECS Fargate (API) | 6–10 tasks × 2 vCPU / 4 GB, auto-scaling | ~$550 |
| Database | db.r6g.xlarge Multi-AZ (or Aurora) + 2 read replicas | ~$1,250 |
| DB backups / PITR / snapshots | large data set | ~$100 |
| Application Load Balancer | higher LCU | ~$50 |
| ElastiCache (Redis) | cache.m6g.large | ~$180 |
| S3 | hundreds of GB–low TB + lifecycle tiers | ~$60 |
| CloudFront | high traffic | ~$90 |
| SES | ~1–3M emails/mo | ~$200 |
| CloudWatch + alarms | high volume (log tiering) | ~$120 |
| OpenSearch (optional) | small managed cluster | ~$250 |
| WAF | managed + custom rules | ~$40 |
| KMS / Secrets / ECR / Route 53 | | ~$45 |
| SMS for MFA | large staff base | ~$120 |
| Data transfer out | high | ~$150 |
| **Mature total — on-demand** | | **≈ $3,050–$3,300 / month** |
| **With 1-yr reserved/savings-plan commitments** | compute + DB reserved (~30–40% off those lines) | **≈ $2,300–$2,600 / month** |

> **Plan figure: ~$3,000–$3,300/month on-demand, ~$2,300–$2,600 with commitments.** OpenSearch omitted from the lower end.

---

## 6. Year-one cost roll-up

Production cost ramps with the three phases, so the 12-month total is **not** 12 × the exit rate:

| Phase | Months | Est. $/month | Months × rate |
|---|---|---|---|
| Phase A (~50 businesses) | 1–3 (3 mo) | ~$290 | ~$870 |
| Phase B (~500 businesses) | 4–8 (5 mo) | ~$460 | ~$2,300 |
| Phase C (~2,000 businesses) | 9–12 (4 mo) | ~$930 | ~$3,720 |
| **Production subtotal (year one)** | | | **≈ $6,900** |
| Development | 1–12 (12 mo) | ~$70 | ~$840 |
| CI/CD (GitHub Actions) | 1–12 | ~$0–$40 | ~$0–$480 |
| **Year-one hosting total** | | | **≈ $7,700–$8,200** |

- **Blended production average:** ~$575/month across year one.
- **Month-12 exit run-rate (Dev + Prod + CI/CD):** ≈ **$1,000/month**, trending to the **~$3,000/month** mature tier in year two as the base grows past 2,000 businesses.
- **One-time, on top of the above:** the pre-launch penetration test (§8a, ~$5,000–$15,000).

---

## 7. Summary table (for the business plan)

| Phase | Timing / scale | Est. $/month |
|---|---|---|
| **Development** | throughout (real email via SES prod access) | **~$70** |
| **Production — Phase A** | months 1–3, ~50 businesses | **~$280–$320** |
| **Production — Phase B** | months 4–8, ~500 businesses | **~$420–$500** |
| **Production — Phase C** | months 9–12, ~2,000 businesses | **~$880–$1,000** |
| **Production — mature (Year 2+)** | beyond 2,000 businesses | **~$3,000–$3,300** (on-demand) / **~$2,300–$2,600** (committed) |
| **Shared: CI/CD (GitHub Actions)** | throughout | **~$0–$40** (see §8) |

**Day-one run-rate (Dev + Phase A Prod + CI/CD): ≈ $370–$430 / month.**
**Year-one hosting total: ≈ $7,700–$8,200** (plus the one-time ~$5k–$15k pen test).

**One-time launch costs** (not monthly — see §8a): a pre-launch **penetration test** (~$5,000–$15,000, Phase 02 Req 12) and Apple Developer / OAuth setup (~$100/yr).

---

## 8. What's excluded (and belongs elsewhere in the plan)

These are real costs but not AWS *hosting*, so keep them in other line items:

- **Stripe processing fees** — a cost of revenue (≈2.9% + fixed per transaction, plus Connect fees). Scales with GMV, not hosting.
- **CI/CD — GitHub Actions** (Phase 01): the pipeline builds/tests/lints on every push and PR. The GitHub **free tier** (2,000–3,000 minutes/mo on private repos) likely covers a two-developer cadence at first (~$0); beyond that, overage is ~$0.008/min, so budget **$0–$40/mo** as build volume grows. Versioned build artifacts stored in GitHub (later S3/ECR — already in the AWS lines).
- **Domain registration** (~$15–40/yr) — trivial, but not AWS.
- **Marketing email/SMS** — the SES and MFA-SMS figures cover *transactional* mail and *MFA* codes. A bulk marketing pipeline (SendGrid/Listrak per the roadmap) and marketing SMS are separate, usage-based, and belong under marketing costs.
- **OAuth identity providers** (Google/Facebook/Apple sign-in, Phase 02 Req 2) — free to use; Apple requires a **$99/yr Apple Developer** membership (also needed for the mobile app).
- **Third-party APIs** chosen later (maps/geocoding, calendar sync, AI/LLM, video hosting) — each usage-based; add as adopted.
- **Developer/ops labor**, support tooling, external monitoring SaaS (if not CloudWatch).
- **Sales tax/VAT** on AWS invoices (region-dependent).

## 8a. One-time / launch costs

Not monthly — budget these as project costs around launch:

| Item | Driver | Est. one-time |
|---|---|---|
| Penetration test before production launch | Phase 02 Req 12.8 (required before launch) | ~$5,000–$15,000 |
| Security/compliance review (GDPR readiness, Phase 02 Req 8) | if done by outside counsel/consultant | ~$2,000–$8,000 (optional) |
| Apple Developer Program | OAuth Apple Sign-In + mobile app | ~$99/yr |
| Initial AWS setup / IaC (if outsourced) | one-time infra build-out | labor, varies |

> The penetration test is the notable one for the business plan — Phase 02 makes it a **pre-launch requirement**, so it's a real gating cost, not optional polish.

---

## 9. Cost-reduction levers (notes for the plan)

- **Compute Savings Plans / Reserved Instances** — 1- or 3-yr commitments cut Fargate and RDS ~30–50% on steady-state capacity. Apply once load is predictable (post-Initial).
- **Fargate Spot** for non-critical/batch tasks (not the always-on API).
- **RDS right-sizing + gp3 storage** — start smaller, scale the instance class with real metrics rather than over-provisioning.
- **S3 lifecycle policies** — move old uploads to Infrequent Access / Glacier.
- **CloudWatch log retention + tiering** — logs quietly become a top-5 line at scale; set retention and export cold logs to S3.
- **Dev scale-to-zero** off-hours (noted in §3).
- **Single NAT / minimal networking** early — avoid premature multi-AZ NAT gateway costs where not required.

---

## 10. Assumptions & confidence

- Prices are **2026 AWS on-demand list prices**, US region, rounded; gathered from AWS pricing pages and public pricing trackers. Expect ±15–20% variance on any given month.
- **Region / data residency (GDPR, Phase 02 Req 8):** if Spain/EU is the launch market, deploy in an **EU region** (e.g. `eu-west-1` Ireland or `eu-central-1` Frankfurt) so customer PII and health-related notes reside in the EU. EU regions run **~5–15% higher** than US on most lines — apply that uplift to every figure above if EU is chosen. The architecture is identical; only the price list and region change.
- Business-count ranges per tier are **illustrative load bands**, not hard limits — actual capacity depends on booking/payment intensity per business, which we'll calibrate with real production metrics.
- The architecture assumes the current monolith shape holds. If DayStream later splits background workers into a separate service, add a small Fargate line (~$30–70/mo) and subtract nothing material.
- **Highest-confidence lines:** Fargate, RDS, ALB, ElastiCache (well-anchored list prices). **Lowest-confidence:** data transfer, CloudWatch, SES at scale (usage-driven; refine with real metrics).
- Recommend validating with the **AWS Pricing Calculator** before the plan is finalized, using these service selections as the input.
