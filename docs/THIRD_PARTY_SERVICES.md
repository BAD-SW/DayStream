# Third-Party Service Decisions

No third-party service is pre-selected. Each service integration will be evaluated when the relevant phase requires it. This document tracks the evaluation status and decisions for each.

## Evaluation Criteria

When evaluating a service, consider:
- **Cost** — Pricing model, free tier, cost at scale (50 → 10,000 businesses)
- **Multi-tenancy support** — Can it handle per-tenant isolation?
- **API quality** — Documentation, SDKs, TypeScript support
- **Lock-in risk** — How hard is it to switch later?
- **Regional availability** — Works in Spain, US, and globally?
- **Compliance** — GDPR, data residency options
- **Abstraction** — Can we build an interface that allows swapping providers?

---

## Status Legend

- 🔲 Not yet evaluated
- 🟡 Under evaluation
- ✅ Decided
- ❌ Rejected

---

## Payment Processing

| Option | Status | Notes |
|---|---|---|
| Stripe | 🔲 | Proposed — strong multi-tenant support (Connect) |
| PayPal | 🔲 | |
| Adyen | 🔲 | |
| GoCardless | 🔲 | Direct debit focused |
| SumUp | 🔲 | POS focused |

**Decision:** TBD  
**Phase:** 10 (Payment Platform)

---

## Authentication

| Option | Status | Notes |
|---|---|---|
| Auth0 | 🔲 | Organizations feature for multi-tenant |
| Clerk | 🔲 | Developer-friendly, good React/RN SDKs |
| AWS Cognito | 🔲 | AWS-native, complex but powerful |
| Custom (Passport.js / self-built) | 🔲 | Full control, more work |

**Decision:** TBD  
**Phase:** 02 (Security & Compliance)

---

## Email Delivery

| Option | Status | Notes |
|---|---|---|
| AWS SES | 🔲 | Cheap at scale, AWS-native |
| SendGrid | 🔲 | Good API, template support |
| Postmark | 🔲 | Fast delivery, transactional focus |
| Resend | 🔲 | Modern API, developer-friendly |

**Decision:** TBD  
**Phase:** 16 (Marketing & Automation)

---

## SMS

| Option | Status | Notes |
|---|---|---|
| Twilio | 🔲 | Market leader, global coverage |
| MessageBird | 🔲 | European, WhatsApp support |
| AWS SNS | 🔲 | AWS-native |

**Decision:** TBD  
**Phase:** 16 (Marketing & Automation)

---

## File/Image Storage

| Option | Status | Notes |
|---|---|---|
| AWS S3 | 🔲 | Production target |
| Local filesystem | 🔲 | Development workaround |
| Cloudflare R2 | 🔲 | S3-compatible, no egress fees |

**Decision:** TBD  
**Phase:** 00 (Infrastructure)

---

## Search

| Option | Status | Notes |
|---|---|---|
| Elasticsearch | 🔲 | |
| OpenSearch (AWS) | 🔲 | AWS-managed Elasticsearch fork |
| Meilisearch | 🔲 | Lightweight, easy to self-host |
| PostgreSQL full-text search | 🔲 | No extra service, may suffice initially |

**Decision:** TBD  
**Phase:** 03 (Core Platform)

---

## Caching

| Option | Status | Notes |
|---|---|---|
| Redis | 🔲 | Industry standard |
| AWS ElastiCache | 🔲 | Managed Redis on AWS |
| In-memory (local dev) | 🔲 | Development workaround |

**Decision:** TBD  
**Phase:** 03 (Core Platform)

---

## Push Notifications (Mobile)

| Option | Status | Notes |
|---|---|---|
| Expo Push | 🔲 | Built into Expo |
| Firebase Cloud Messaging | 🔲 | Google-backed, free |
| OneSignal | 🔲 | Multi-channel |
| AWS SNS | 🔲 | AWS-native |

**Decision:** TBD  
**Phase:** 19 (Mobile App)

---

## Calendar Sync

| Option | Status | Notes |
|---|---|---|
| Google Calendar API | 🔲 | Direct integration |
| Microsoft Graph API | 🔲 | Outlook/O365 |
| Nylas | 🔲 | Unified calendar API (abstracts both) |

**Decision:** TBD  
**Phase:** 20 (Integrations)

---

## Video Hosting (VOD)

| Option | Status | Notes |
|---|---|---|
| Mux | 🔲 | Developer-friendly video API |
| Cloudflare Stream | 🔲 | Simple, flat pricing |
| AWS MediaConvert + S3 | 🔲 | AWS-native |

**Decision:** TBD  
**Phase:** 22 (Community & Engagement)

---

## AI / LLM

| Option | Status | Notes |
|---|---|---|
| OpenAI | 🔲 | GPT models |
| Anthropic (Claude) | 🔲 | |
| AWS Bedrock | 🔲 | Multi-model, AWS-native |
| Self-hosted (Ollama/vLLM) | 🔲 | Privacy, cost control |

**Decision:** TBD  
**Phase:** 21 (AI Features)

---

## Design Principle

For every third-party service, we will:
1. **Define an interface/abstraction layer** — business logic never calls a provider directly
2. **Evaluate at the point of need** — not before
3. **Document the decision** — rationale, cost analysis, migration path
4. **Plan for switchability** — no vendor lock-in without conscious trade-off
