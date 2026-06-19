# Product 03 — Grants & Funding Intelligence (working name: Funding Navigator)

> Product roadmap for the second Whiphand offering, running alongside Auto Lobby on the same platform foundation.
> Read `docs/Platform-Roadmap.md` first — this doc expands Product 03's row into a build plan.
>
> Last updated: 2026-06-19 · Status: design

---

## What this is

Auto Lobby automates the *compliance* touchpoint between a Canadian business and its government. Funding Navigator automates the *capital* touchpoint: it finds every program a company is eligible for, ranks them by value and winnability, and drafts the application so the team only has to review and sign.

The core loop mirrors Auto Lobby's "one button per month" discipline:

1. **Profile** — the company answers a structured intake once (sector, stage, revenue, employees, locations, activities, projects, planned spend). The profile is reusable across every program and persists as the company evolves.
2. **Discover** — match the profile against a comprehensive catalog of funding from all levels (federal, provincial/territorial, municipal) plus government-funded bodies (BDC, EDC, Canada Growth Fund, NRC IRAP, the regional development agencies, Crown corporations, and arm's-length innovation agencies like Alberta Innovates / Innovate BC).
3. **Rank** — surface a ranked shortlist with the eligibility criteria that matter, award size, deadline, repayable vs. non-repayable, stacking constraints, and a direct link to the program.
4. **Draft** — for programs with an online intake or downloadable form, pre-populate the application from the profile and a reusable evidence vault, with field-level provenance.
5. **Review & submit** — the authorized signer reviews, edits, and submits. Nothing auto-submits.

Target friction: a company sees its full opportunity set within minutes of onboarding, and turns a matched program into a review-ready draft in under an hour instead of the days a consultant engagement takes today.

---

## Why this is the largest opportunity on the platform

- **TAM.** ~99 federal business programs are commonly cited; aggregators verify 600+ programs across all levels of government. Canada directs $50B+ a year in business support (grants, repayable contributions, tax credits, wage subsidies). The most-cited count of genuinely non-repayable grants is ~112.
- **SR&ED alone** pays out $4.5B+ a year to 20,000+ businesses, at 35% refundable on the first $6M of qualifying spend for CCPCs (expenditure limit doubled and capital eligibility restored in the 2024–25 reforms). It is rules-based, recurring, and audited — ideal for a provenance-first automation product.
- **Buyer overlap with Auto Lobby.** Any company with a government affairs function is also deploying capital or running R&D. Tier-1 sectors (mining/critical minerals, cleantech/climate, pharma/life sciences) are the heaviest grant users. A Deep Sky-type cleantech account is the archetype pilot (NRCan, SDTC-successor programs, Canada Growth Fund).
- **The incumbents are consulting shops.** Ryan (which absorbed Mentor Works), GrantMatch, and the SR&ED specialists (e.g. Boast) sell expensive human engagements, often on contingency. Directories (helloDarwin, The Funding Portal, grantcompass) sell leads. Nobody owns the full loop — discovery → eligibility → draft → submission → post-award compliance — as integrated, provenance-backed software.

---

## Data foundation — the moat

The same way Auto Lobby's moat is the OCL comm-report corpus and the DPOH graph, Funding Navigator's moat is two public datasets stitched into a private intelligence layer:

1. **Program catalog.** Innovation Canada's Business Benefits Finder is published as an open dataset on open.canada.ca (`4e75337e-70d0-4ed7-92d1-3b85192ec6b1`), downloadable and structured (funding, loans, tax credits, wage subsidies, advisory, partnerships). It is the federal spine. Provincial and municipal programs have no single feed — they require scraping + structured extraction (a job the platform already does well for the DPOH registry).

2. **Disbursement history.** The Proactive Disclosure — Grants and Contributions dataset (`432527ab-7aac-45b5-81d6-7597107a7013`) consolidates every federal grant and contribution actually paid: recipient, amount, program, date. This is the funding analog of the OCL comm reports — proprietary intelligence once cleaned and joined to the catalog. It tells us *who actually won, how much, from which program, in which sector*. That powers win-probability scoring, realistic award-size estimates, and "companies like you also received…" — none of which the directories offer.

**Reference tables (read-only, idempotent import — same discipline as the OCL tables):**

- `funding_program` — the catalog: program, funder, level, instrument type, value range, intake cadence, eligibility rules (structured), stacking rules, source URL, intake URL/form.
- `funding_program_source` — provenance per program (which feed/scrape/version it came from, last verified).
- `funding_disbursement` — historical grants & contributions (federal first; provincial where available). Filtered to a useful window the way `ocl_public_communication_report` is filtered to 2019+.

Budget for the catalog + disbursement import the way the OCL import is budgeted (Neon free tier 0.5 GB; TRUNCATE-in-transaction; DB-size logging). Disbursement history is the large table — plan the window deliberately.

---

## Product modules (`src/server/funding/`)

Follows the platform's `src/server/<product>/` convention.

- `program-registry/` — catalog ingestion, normalization, and de-duplication across levels of government; structured eligibility-rule extraction; intake-form detection (online portal vs. downloadable PDF/Word vs. email-only).
- `eligibility/` — the matching engine: company/project profile × structured program rules → eligible / likely / ineligible, with a reason row per rule (the `EligibilityReason` analog of `ClassificationReason`).
- `funding-intelligence/` — joins disbursement history to the catalog: win-probability, typical award size, funder behavior, stacking/cumulation analysis, competitive context.
- `deadline-radar/` — continuous monitoring of intake windows and new-program launches; alerting (reuses Inngest).
- `application-engine/` — draft generation with field-level provenance; budget builder; evidence-vault binding; export to the program's actual form.
- `submission/` — supervised assisted submission for online portals (Playwright, headed, human-in-the-loop — the Auto Lobby pattern), or a prepared package for offline forms.

**New schema (additive, platform-aware):**

- `FundingProfile` — the reusable company answers (extends, not duplicates, the existing `Tenant`; cross-product profile reuse for Auto Lobby accounts).
- `FundingProject` — funding is project-centric, not company-centric. A hiring plan, a capital expansion, an R&D initiative. Programs match to projects.
- `EligibilityAssessment` + `EligibilityReason` — per program × project, with provenance.
- `FundingOpportunity` — a ranked, surfaced match (assessment + value + deadline + win-probability).
- `ApplicationDraft` — pre-filled form with source tags on every field (mirrors `DraftMcr`).
- `EvidenceItem` — the document vault (financials, incorporation, T2s, project descriptions, prior approvals), reusable across applications.
- `FundingProgram` / `FundingDisbursement` — reference tables above.

Reuse `AuditEvent` (platform-level), Clerk tenancy, the agency/branding fields, and the human-in-the-loop submission harness as-is.

---

## Expert value-add features (beyond the four-step ask)

These are where a grants practitioner adds value that the directories and the AI-writing tools miss. They are the reason to build this rather than resell a feed.

1. **Stacking / cumulation engine.** Most programs cap *total government assistance* on a project (often 50–75% of eligible costs across all federal/provincial/municipal sources combined). Naively applying to everything breaches the cap and claws back funding. The engine should assemble an *optimal portfolio per project* that maximizes non-repayable dollars without breaching any program's stacking limit. This is the single highest-value, least-commoditized feature.

2. **Win-probability + realistic award sizing.** From disbursement history: "programs like this fund ~X% of applicants in your sector at a median award of $Y." Stops teams chasing low-probability, high-effort programs. No competitor has the data join to do this credibly.

3. **Project-based architecture.** Model the company's actual initiatives and match programs to each, rather than a flat company-level list. A single capital project might stack a regional development grant + a provincial job grant + SR&ED + a clean-tech incentive.

4. **Funding calendar / deadline radar.** Many programs are intake-window based and some are first-come-first-served on a fixed envelope. Continuous monitoring + proactive alerts (scheduled tasks) so a company never misses a window or a newly launched program. Recurring engagement, not a one-time scan.

5. **SR&ED claim assistant (dedicated sub-product).** Given its size, recurrence, rules-based test (three-part CRA test), and audit exposure, SR&ED deserves its own module: project/time capture, technical-narrative drafting against the eligibility test, eligible-expenditure calculation (proxy vs. traditional), and T661 preparation — all with the provenance trail that survives a CRA review. Note the policy sensitivity around contingency fees here (see Revenue).

6. **Post-award compliance & reporting.** Winning is the start of the obligation, not the end: claim submissions, milestone/progress reports, holdback releases, and audit support. This is the funding analog of Auto Lobby's monthly cadence — recurring, sticky, and where companies actually drop the ball. Strong retention driver.

7. **Eligible-cost budget builder.** Per-program categorization of eligible vs. ineligible costs, so the application budget is built correctly the first time (the most common rejection/clawback cause).

8. **Evidence vault with auto-fill.** Onboard documents once; the engine maps them into every future application. Drastically cuts per-application effort and is a switching-cost moat.

9. **Matching-funds & partner finder.** Some programs require co-applicants, academic partners, or private matching capital. Surface what's needed and (later) help source it.

10. **Audit-defense pack.** For SR&ED and contribution agreements, maintain the provenance trail and supporting evidence so an audit is a document-export, not a fire drill. Plays directly to the platform's explainability competency.

11. **Renewal & re-application automation.** Annual and multi-year programs re-open; the platform should pre-stage the next cycle from the last filing.

12. **Cross-product intelligence (platform play).** Lobbying activity (Auto Lobby) and funding pursuit are correlated — a company lobbying NRCan is often also chasing NRCan programs. With consent and within-tenant only (no cross-tenant training), surface that connection. This is something only a unified platform can do.

Explicitly **not** in scope (consistent with `docs/Platform-Roadmap.md`): procurement/contract bidding (CanadaBuys), ITB/offset management, and charitable/nonprofit grant-writing. Funding Navigator is for businesses seeking government capital.

---

## Non-negotiable constraints (inherited + funding-specific)

1. **Human-in-the-loop submission.** No application auto-submits. An authorized signer reviews and submits, exactly as the CEO certifies in Auto Lobby. Many funders also require a signing-officer attestation — honor it natively.
2. **Anti-false-eligibility bias** (the funding analog of anti-over-reporting). Default to "likely / verify" over "eligible" on marginal signals. Telling a company it qualifies when it doesn't wastes its time and burns trust faster than a missed program. Every eligibility call carries its reasons.
3. **Explainable matching.** Every eligibility determination, ranking, and pre-filled field shows *why* — which rule, which profile fact, which data source.
4. **No credential custody.** Assisted portal submission uses a supervised session; the user authenticates in-session. Same as LRS.
5. **No cross-tenant training.** Per-tenant only. Disbursement *history* is public data and fair to use platform-wide; a tenant's profile, projects, and documents never leave the tenant.
6. **Canadian data residency, PIPEDA.** From day one.
7. **Architect for the agency motion.** GR firms, accounting firms, and grant consultants will manage client portfolios under white-label — the same two-motion architecture Auto Lobby already carries (`agencyId`, branding fields, `AuditEvent` actor attribution).

---

## Build phases

Internal product phases. Maps to platform Phase 7–8 in `docs/Platform-Roadmap.md`. "All levels day one" is the coverage target for GA, sequenced so federal lands first and provincial/municipal fill in fast behind it.

| Phase | Milestone |
|-------|-----------|
| **G0 — Data foundation** | Import Business Benefits Finder catalog (federal) + Grants & Contributions disbursement history; build `funding_program` / `funding_disbursement` reference tables (idempotent). Structured eligibility-rule schema defined. |
| **G1 — Profile + discovery** | `FundingProfile` + `FundingProject` intake; eligibility engine v1 (federal); ranked opportunity list with criteria, value, deadline, links. Read-only — proves the match quality. |
| **G2 — Provincial + municipal + funded orgs** | Extend `program-registry/` scrapers to all provinces/territories, major municipalities, and government-funded bodies (BDC, EDC, Canada Growth Fund, regional agencies, Alberta Innovates / Innovate BC, etc.). This is the "all levels" coverage push. |
| **G3 — Intelligence layer** | Win-probability + award sizing from disbursement history; stacking/cumulation engine; deadline radar with alerts. |
| **G4 — Application drafting** | Evidence vault; `application-engine/` draft generation with provenance; budget builder; export to the program's actual form. Pilot account (cleantech archetype). |
| **G5 — Assisted submission + SR&ED + post-award** | Supervised portal submission; SR&ED claim assistant sub-module; post-award reporting & compliance tracking. Success-fee model live; GA. |

Pilot target: a Tier-1 cleantech account already pursuing NRCan / Canada Growth Fund programs — same archetype as the Auto Lobby flagship.

---

## Revenue model

- **SaaS per tenant**, tiered by company size / number of active projects. Agency motion priced per client under management (10–20x like Auto Lobby).
- **Optional success fee** on funded applications (the roadmap notes 0.5–1.5% of grant value). Two cautions to design around:
  - Pure grant-writing contingency fees are discouraged or prohibited by some funders and professional bodies (AFP/GPA), and some grant terms forbid paying the writer from awarded funds. Keep the SaaS the primary model; treat success fees as optional and program-compatible only.
  - SR&ED contingency fees (historically up to ~30%) are under explicit government scrutiny. Position Funding Navigator as the low-cost software alternative to 20–30% SR&ED contingency shops — that contrast is itself a marketing wedge.
- **Cross-sell.** Auto Lobby accounts are warm — one invoice, two product line items (the `entitlements` groundwork already planned in Phase 5d).

---

## Open questions to resolve before G0

1. **Disbursement history window.** How far back is useful for win-probability without blowing the Neon budget? (OCL precedent: 2019+.)
2. **Eligibility-rule representation.** How structured can program rules be made? Some are crisp (sector, region, headcount, % Canadian-owned); many are narrative. Likely a hybrid: structured filters + an LLM "fit assessment" with provenance, defaulting to "verify."
3. **Form coverage reality.** What fraction of programs have a machine-fillable online portal vs. PDF vs. email-only? This sizes the G4/G5 automation payoff and should be sampled during G0.
4. **Provincial scrape maintenance.** No feeds means ongoing scrape upkeep. Reuse the GEDS/registry scraping patterns and verification cadence from the DPOH registry.
5. **SR&ED depth.** Standalone sub-product vs. a module — given its size, it may warrant its own pricing and GTM.
