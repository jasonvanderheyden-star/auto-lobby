# Platform Roadmap — Source of Truth

> **This is the canonical product roadmap.** When asked "what's next?" or "what are we building?", read this file. The formatted external version lives at `docs/Platform-Roadmap-Strategy.docx`.
>
> Last updated: 2026-05-21

---

## Platform thesis

Every serious interaction a Canadian business has with its government produces a compliance obligation, a monitoring requirement, a funding opportunity, or a regulatory constraint. Today all four are handled manually. This platform automates the government-facing interface end-to-end as a unified intelligence layer.

**Company working name:** TBD — see `docs/Naming-Parked.md` and `docs/Platform-Vision-Parked.md`. "Auto Lobby" is the first *product* name, not the parent brand.

---

## The four products

### Product 01 — Lobbying Compliance (Auto Lobby)
Automate OCL/LRS federal lobbying filings. One certified CEO click per month.

- **Market:** ~5,000 registered federal lobbyists; GR teams, GR law firms, consultancies
- **Core loop:** Calendar ingestion → DPOH resolution → lobbying classification → MCR draft → CEO certifies → LRS submission
- **Status:** Phase 3 complete (Deep Sky live). Phase 4 (LRS submission harness) is next.
- **Revenue model:** SaaS per tenant; 10–20x multiplier on agency (GR firm) motion

### Product 02 — Government Intelligence & Monitoring (working name: Policy Track)
Know what government is doing before it affects you.

- **Market:** Any company with a government affairs function — broader than registered lobbyists
- **Core loop:** Monitor Canada Gazette + OiC + committee proceedings + budget docs → filter by registered subjects and known DPOHs → alert + generate consultation response drafts
- **Status:** Design phase — next product after Compliance launch
- **Differentiation:** Monitoring market is crowded (Quorum, FiscalNote, Meltwater). This product's moat is *integration* — alerts connect directly to a company's compliance record and known officials, not a generic clipping service
- **Also includes:** OCL competitive intelligence (what peers are lobbying on from public data); DPOH appointment tracking

### Product 03 — Grants & Funding Intelligence (working name: Funding Navigator)
From eligibility discovery to ready-to-submit application drafts.

- **Market:** Any Canadian company deploying capital or running R&D. 600+ federal programs, $30B+ annual disbursements. Largest TAM on the platform.
- **Core loop:** Company profile → eligibility matching against all programs → ranked opportunities → retrieve guidelines → generate application draft → team completes → submit
- **Status:** Next product after Intelligence
- **Revenue model:** SaaS + optional success fee (0.5–1.5% of grant value on funded applications)
- **Deep Sky relevance:** Actively pursuing NRCan, SDTC, Canada Growth Fund programs — ideal pilot

### Product 04 — Regulatory & Permitting Roadmap (working name: Reg Map)
Navigate complex multi-agency permitting from pre-application to approval.

- **Market:** Project developers in mining, energy, infrastructure, climate tech — anyone triggering IAA, NEB, or provincial environmental review
- **Core loop:** Project type + geography → full permit matrix → sequenced roadmap with dependencies + timelines → track open processes + condition compliance
- **Status:** Future — after Grants launch
- **Revenue model:** SaaS; high per-account value ($25–100k/yr)

---

## Roadmap phases

| Phase | Period | Product | Key milestone |
|-------|--------|---------|---------------|
| 0–1 | Complete | 01 Compliance | Calendar ingestion, DPOH registry, classifier live |
| 2–3 | Complete | 01 Compliance | Certification UI, subject picker, OCL history hints |
| **4** | **H1 2026** | **01 Compliance** | **LRS Playwright submission harness (supervised GCKey) ← NEXT** |
| 5 | H2 2026 | 01 Compliance | Multi-tenant launch, GR firm agency motion, first paying accounts; annual registration renewal automation |
| 5.5 | H2 2026 | 02 Intelligence | Canada Gazette + OiC monitoring, DPOH appointment alerts, OCL competitive intelligence feed |
| 6 | H1 2027 | 02 Intelligence | Committee proceedings, consultation submission drafting, provincial monitoring expansion |
| 6.5 | H1 2027 | 01 Compliance | Provincial expansion: Ontario LRA, BC Lobbyists Transparency Act, Quebec Lobbyists Act |
| 7 | H2 2027 | 03 Grants | Federal program database, eligibility matching engine, Deep Sky pilot |
| 8 | H1 2028 | 03 Grants | Application draft generation, provincial programs, success-fee model, GA |
| 9 | H2 2028 | 04 Permitting | Federal permitting matrix (IAA, NEB, key sector agencies), roadmap generator, pilot |
| 10 | 2029 | All | Unified platform dashboard, cross-product intelligence, Series A target |

**Current position: between Phase 3 (complete) and Phase 4 (blocked on LRS screenshots from law firm).**

---

## Sector priorities

**Tier 1** — all four products highly relevant, largest GR budgets:
- Mining & Critical Minerals
- Clean Technology & Climate (Deep Sky archetype)
- Pharmaceuticals & Life Sciences

**Tier 2** — 2–3 products relevant, strong budgets:
- Financial Services (Compliance + Intelligence; no grants/permitting)
- Telecommunications & Media (Compliance + Intelligence)
- Defence & Aerospace (Compliance + Grants)
- Oil & Gas / LNG (all four)

**Tier 3** — developing opportunity:
- Agriculture & Food
- Real Estate & Infrastructure
- Technology & AI

---

## Go-to-market motions

**Direct:** In-house GR teams at Tier 1/2 corporates. Entry via Compliance; expand to Intelligence, Grants, Permitting as wallet share grows.

**Agency:** GR firms and regulatory law firms managing client portfolios. Single account = multiple client ARR. Priced per-client-under-management. White-label infrastructure built into architecture from day one. Activates at Phase 5.

**Provincial expansion:** Ontario, BC, Quebec registries add per-customer value without a new product. Phase 6.5.

---

## Shared platform infrastructure

All four products draw from the same foundation — this is what makes the platform defensible:

- **Government data graph** — DPOH registry, institutional graph, grant programs, regulatory authorities. Built for Compliance; extended for each subsequent product.
- **Document generation engine** — field-level provenance for every generated document. MCRs → consultation submissions → grant applications → permitting roadmaps.
- **Calendar & meeting intelligence** — one ingestion pipeline; four use cases across products.
- **Human-in-the-loop certification** — every output is reviewed and certified before government submission. Non-negotiable.
- **OCL historical intelligence** — 215k+ comm reports as proprietary data asset. Competitive intelligence + DPOH contact patterns + subject matter trends.

---

## What is NOT on the roadmap

- Grassroots / constituent engagement
- Lobbyist relationship CRM or BD pipeline management
- Procurement compliance / ITB offset management (adjacent but different buyer)
- Disclosure engine / SEDAR+ automation (possible Tier 4+ product; don't foreclose, don't build)
- Mobile app
- International markets (US FARA, UK register — future optionality only)

*Note: "legislative intelligence" is no longer out of scope — it is Product 02. The prior "out of scope" framing in CLAUDE.md is superseded by this document.*

---

## Architectural implications of the four-product platform

These govern decisions from now, even while Products 02–04 don't exist in code:

1. **Treat DPOH registry, OCL data, and institutional graph as platform data**, not Auto Lobby data. Future products consume them as-is.
2. **`src/server/<product>/` folder convention** — `ingestion/`, `dpoh-registry/`, `classifier/`, `filing-engine/`, `submission/` are Auto Lobby modules. Future products get their own folders at the same level.
3. **Tenant-level `entitlements`** — add when second product is real. One invoice, multiple product line items.
4. **Shared audit trail** — `AuditEvent` is platform-level. Users who span products get one continuous trail per tenant.
5. **Agency GTM is architectural** — `Tenant.agencyId`, branding fields, `AuditEvent` actor attribution. Already in schema; never remove.
