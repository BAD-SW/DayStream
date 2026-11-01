# Data Protection, Sovereignty & Security (business-plan section)

> Accurate, diligence-ready replacement for §2.3.3 and §2.4. Every claim here reflects the
> platform as actually built or as explicitly planned, with planned items clearly marked as
> such. Phrasing avoids absolutes ("absolute," "guaranteed," "insulated from all liability")
> that technical due diligence would challenge.

---

## 2.3.3 Technical Protection, Data Sovereignty, and Infrastructure Scaling

To support global scalability and international expansion, the platform's technical
management framework is organized into two tracks: a centrally owned core, and a
regionally deployable data layer. During the introductory phase this is directed by the
founders, with the architecture designed to transition to a dedicated engineering and IT
operations team as revenue scales.

### Infrastructure Architecture and Central Security

The core codebase, the multi-tenant data model, the platform's encryption utilities, and
the hosting configuration are managed centrally under a single infrastructure framework.
The platform is designed around a **data-minimization principle**: its core function is the
optimization of schedules, staff, resources, and commerce, and it does **not require or
mandate structured medical records** to operate. Where a business chooses to record
health-adjacent information (for example wellness or recovery notes), that information is
captured as **encrypted free-text notes** rather than as structured clinical data, and is
flagged as sensitive. This lean, opt-in data footprint reduces the platform's regulatory
surface area and keeps it adaptable across B2B service verticals.

> Note: this is a data-minimization posture, not a claim of exemption from health-data
> regulation. Any business operating in a regulated healthcare context remains responsible
> for its own regulatory obligations, and DayStream provides encryption and access controls
> to support that.

### European Data Sovereignty and Regional Isolation (planned)

The platform's architecture is designed to support **regional data isolation** so that, as
DayStream expands into the European Union, European customer and transactional data can be
stored and processed within an EU-based deployment region. This regional-deployment
capability is **part of the planned expansion architecture** and will be implemented ahead
of the formal launch of EU operations. The intellectual property and platform control
remain centrally owned by the Delaware C-Corp parent entity, while the data-storage layer is
designed to be deployable per region to align with local privacy mandates such as the GDPR.
This separation provides a clean operational path for standing up a DayStream Europe
subsidiary with EU data residency.

---

## 2.4 Data Security Framework & Technical Risk Mitigation

### 2.4.1 Security-by-Design and Penetration-Test Program

DayStream is developed under a **security-by-design** approach: authentication, access
control, input validation, and data isolation are built into the platform's architecture
rather than added after the fact. The platform uses parameterized database access
throughout (mitigating injection), hashed-and-salted credential storage (bcrypt), signed
session tokens with server-side refresh-token revocation, and encrypted storage of
sensitive fields.

Ahead of commercial launch, DayStream maintains a **pre-launch security hardening program**
with an internal checklist of items to be remediated (for example, HTTP security headers,
multi-factor authentication enforcement, and startup secret validation), and has **budgeted
for an independent third-party penetration test** prior to onboarding production customers.
This combination — security-by-design engineering plus a tracked remediation program and an
external audit before launch — is intended to make the platform resilient against the common
vulnerability classes (injection, broken authentication, cross-site scripting, and
cross-tenant access) and to provide customers with independent assurance.

### 2.4.2 Multi-Tenant Data Isolation and Access Security

Because DayStream operates as B2B multi-tenant infrastructure, preventing cross-tenant data
exposure is a primary design priority. The platform enforces isolation and access control
through the following mechanisms:

- **Request-level tenant isolation.** Isolation is enforced on **every request** in the
  application layer: the tenant identity is carried in a signed session token, and every
  business-scoped operation requires a validated `business_id` that is checked against the
  caller's permitted scope — with no fallbacks or defaults. The database schema additionally
  defines **row-level security policies** as a defense-in-depth layer. Together these ensure
  that a Territory Tenant and its individual businesses cannot access one another's data.

- **Encryption of sensitive data.** Sensitive stored data — including customer notes and
  payment-provider credentials — is **encrypted at rest using AES-256-GCM** with
  per-record initialization vectors and authentication tags. Data in transit is protected by
  **Transport Layer Security (TLS)** terminated at the hosting edge/load balancer. Payment
  card data is handled via tokenization through the payment processor and is not stored on
  the platform directly.

- **Role-Based Access Control (RBAC) across a four-tier model.** Access is scoped to a
  four-level entity model — **DayStream (platform), Territory Tenants, Businesses, and
  Customers** — with role-based permissions within each level (for example owner, manager,
  reception, practitioner). Users are bound to their operational scope, so a single
  compromised credential is limited in blast radius to that user's permitted layer. Elevated
  personas can view into a narrower scope for support purposes without changing their
  underlying identity, and every such context switch is audit-logged.

- **Audit logging.** Security-relevant actions are recorded in a tamper-evident audit log
  (hash-chained entries), supporting investigation and accountability.

---

## 2.5 Internationalization and Accessibility

### 2.5.1 Multi-Language and Localization

DayStream is **built for international, multi-language operation** rather than retrofitted
for it. The application is engineered with an internationalization (i18n) framework so that
interface text can be presented in multiple languages, and the data model carries language
and country as first-class attributes — each business operates in a configured default
language, and each customer record stores the customer's language and country. Dates,
times, and currency are handled in a locale-aware manner. This foundation is central to the
company's European expansion strategy (the first reference deployments span the United
States and Mallorca, Spain) and lets a single platform serve businesses and their customers
in their own languages without separate codebases. Expanding the set of fully translated
languages is an ongoing, content-level effort that builds on this architecture rather than
requiring re-engineering.

### 2.5.2 Accessibility (WCAG 2.1 AA)

Accessibility is engineered into the platform's design system to the **WCAG 2.1 AA**
standard rather than treated as an afterthought. Concrete measures built into the product
include:

- **Enforced color contrast.** The design system includes a contrast-ratio utility that
  checks color combinations against WCAG AA thresholds (4.5:1 for normal text, 3:1 for large
  text). Each built-in theme ships with documented, verified contrast ratios, and when a
  business customizes its brand colors, the platform **validates those overrides and warns
  if a chosen color would fail AA contrast** — so tenant branding cannot silently break
  accessibility.
- **Keyboard and assistive-technology support.** Interface components use semantic roles and
  ARIA labeling (menus, regions, groups, controls), provide visible keyboard focus
  indicators, and require descriptive labels on icon-only controls at the code level.
- **Light and dark themes** with accessible contrast in both modes.

This design-level conformance positions the platform to meet accessibility expectations in
both commercial and public-sector / enterprise procurement, including the EU market. As is
standard practice, formal WCAG 2.1 AA conformance for a release is confirmed through manual
testing with assistive technologies and expert review; the platform's architecture and
design system are built to make reaching and maintaining that conformance achievable.

---

### Summary of what is in place today vs. planned

*(Optional internal note — remove before external distribution if desired.)*

| Capability | Status |
|---|---|
| Four-tier RBAC + context switching + audit log | In place |
| Application-layer tenant/business isolation (validated `business_id` per request) | In place |
| Row-level security policies defined in schema (defense-in-depth) | Defined; application layer is the primary enforcement today |
| AES-256-GCM encryption of sensitive fields (notes, payment credentials) | In place |
| Parameterized queries / bcrypt / refresh-token revocation | In place |
| TLS in transit (at load balancer) | In place via hosting |
| i18n framework wired + per-business/customer language & country data | In place (framework/foundation) |
| Full UI translation across multiple languages | In progress (content-level) |
| WCAG 2.1 AA design system: contrast utility, theme validation, ARIA, focus indicators | In place (design-level) |
| Formal WCAG 2.1 AA conformance audit (assistive-tech + expert review) | Planned (pre-launch) |
| Security hardening checklist (headers, MFA enforcement, secret validation, token revocation) | In progress (pre-launch) |
| Independent third-party penetration test | Planned & budgeted (pre-launch) |
| EU regional data isolation / residency | Planned (expansion architecture) |
| Production AWS global hosting footprint | Planned (see deployment plan) |
