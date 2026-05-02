# Platform vision — parent brand + product portfolio (parked)

This is parked as a *naming and branding exercise* — resume after Phase 3 ships (Monthly Certification UI live with ≥1 paying customer or design partner under contract). It is **not** parked as an *orientation* — it should govern how we name, architect, and sell from here forward.

## The shift in framing

Auto Lobby is a single product. The actual ambition is a **platform of regulatory tools** for Canadian companies operating in regulated industries. Auto Lobby is the first product, not the company.

This isn't a rebrand of Auto Lobby. It's the recognition that:

- Auto Lobby may stay being a great product name (TBD in naming exercise)
- The **company / parent brand** is something larger that houses Auto Lobby + future products
- Architecture, sales motion, and brand discipline should reflect "platform from day one" even when only one product exists in code

## The category

This sits at the intersection of:

- **RegTech** — regulatory technology, software that automates compliance
- **GovTech** — broader category for technology that interfaces with government
- **Public-affairs technology** — closer fit, but currently means "GR firm tooling" in most usage

The closest US comps are FiscalNote, Quorum, and Bloomberg Government — but they lean into intelligence + relationship CRM, less into compliance + filing automation. The Canadian market is uncovered: no equivalent operator exists at scale.

A natural positioning: **the operating system for regulated industries to navigate Canadian government.**

## The product portfolio

| Product (placeholder name) | What it does | Status |
|---|---|---|
| **Auto Lobby** | Lobbying-Act compliance: detect → classify → draft → certify → submit MCRs | In build (Phase 1 done, Phase 2 next) |
| **Policy Track** | Monitor bills, regs, debates, committee proceedings, Gazette notices, Hansard mentions on chosen subjects; generate weekly digests + alerts | Future — Year 2 |
| **Reg Map** | Generate regulatory + permitting roadmap for a specific project (drug, environmental license, facility, financial product); track each requirement through approval | Future — Year 2 |
| **Consultation Tracker** | Monitor Canada Gazette + provincial equivalents for open consultations; draft and submit comment letters | Future — Year 2–3 |
| **Procurement Intelligence** | Track CanadaBuys / MERX / GETS RFPs against company capability profile; manage supply-arrangement qualifications | Future — Year 3+ |
| **Funding Navigator** | Find federal/provincial grants (SR&ED, IRAP, SIF, etc.); draft applications; manage post-award compliance | Future — Year 3+ |
| **Disclosure Engine** | Automate SEDAR+, OSFI, environmental reporting, Indigenous consultation logs | Future — Year 3+ |

Every product has the same DNA: regulated company needs to navigate Canadian government in some structured way, manual process is painful, data sources are public but fragmented, mistakes have legal consequences. Overlapping customer base, overlapping data sources, overlapping team skills.

## Why this is strategically a step-change

- **TAM expansion.** "Lobbying compliance for federal registrants" — maybe 800–1,500 Canadian organizations × $10–50K ACV = ~$50M TAM. "Regulatory operating system for Canadian regulated industries" — ~10,000 companies × $20–150K ACV = ~$500M+ TAM.
- **Investor narrative.** Series A story becomes "we own a category" not "we have a product." Multi-product platforms attract higher multiples than single-product SaaS.
- **Cross-sell economics.** First-product CAC is expensive. Second product into the same customer is 80%+ margin with dramatically lower acquisition cost. Third compounds.
- **Sticky platform > sticky product.** Single-product SaaS churns when the customer's need changes. A platform with 3+ products embedded in compliance workflow is near-impossible to rip out.
- **Defensive moat.** Each product creates a data graph (DPOH registry, bill-tracker history, permit-graph database). Cumulative data assets become harder to replicate over time.
- **Agency-motion lift.** Agency partners (per `Agency-Motion-Parked.md`) resell the entire portfolio, not just Auto Lobby. Earnscliffe sells "compliance + intelligence + permitting" as a package, increasing per-firm contract value 3–5×.

## The structural pattern

This is how Salesforce, Workday, and ServiceNow grew:

1. Start as a single product (CRM, HCM, ITSM)
2. Build a shared platform layer (data, identity, workflow, audit)
3. Add adjacent products under the same brand
4. Sell modules independently or as enterprise bundles
5. Reposition as a "platform" rather than a product

Auto Lobby is at step 1. Thinking about parent brand + portfolio at step 1 is unusual and a strength — most companies bolt the multi-product story on at step 3 when the architecture doesn't fit and the brand is wrong.

## Architectural implications

These should govern decisions from now, even while the second product doesn't exist:

1. **Shared identity layer.** Clerk Organizations are the spine. Users, tenants, and (via non-negotiable #7) agencies all map through Clerk. Future products inherit this without re-implementing auth.
2. **Shared regulatory data layer.** Currently `OclPublicRegistration`, `OclPublicCommReport`. Future `InstitutionRegistry`, `PublicOfficial`. All future products will reuse: a Policy Track product needs the same institution + DPOH data as Auto Lobby. Treat these as "platform data," not "Auto Lobby data."
3. **Shared audit trail.** `AuditEvent` is platform-level, not product-level. A user who runs filings in Auto Lobby and queries bills in Policy Track gets one continuous audit trail per tenant.
4. **Shared billing.** When billing lands, it should be tenant-level with product line items, not per-product subscriptions. One invoice, multiple products.
5. **Per-product modularity.** Each product lives in its own `src/server/<product>/` folder. Auto Lobby today is `src/server/{ingestion,dpoh-registry,classifier,filing-engine,submission}/`. Future Policy Track is `src/server/policy-track/`. Each product is a service consuming the shared platform layer.
6. **Per-product entitlements.** Tenants subscribe to Auto Lobby only, or Auto Lobby + Policy Track, etc. Add a tenant-level `entitlements` Json field (or similar) once the second product is real, gating access via middleware.

## What's already true

- Multi-tenant architecture (`tenantId` everywhere, RLS)
- Clerk Organizations 1:1 with Tenants
- Event-sourced `AuditEvent` is platform-shaped
- OCL public data tables are read-only reference, reusable across products
- Item #7 in CLAUDE.md (architect for direct + agency GTM) is in the same spirit — it's a platform-level constraint, not Auto Lobby-specific

## What needs to be true (encoded in CLAUDE.md eventually, built lazily)

- `src/server/<product>/` folder convention for new product code
- Tenant-level `entitlements` field gating product access
- "Platform data" namespace clearly separated from per-product business data
- Shared platform services (auth wrapper, audit, billing) extracted into modules a second product can consume without copy-paste

## What we explicitly do NOT do yet

Don't build the platform layer. Don't extract services. Don't pre-design entitlements. Don't pick names. Premature platformization is the #1 way SaaS startups die — building infrastructure before the first product earns its keep produces over-engineered products nobody buys.

The point of this doc is to **not foreclose** the platform shape, not to build it.

## Triggers for activating the platform brand + portfolio motion

- Auto Lobby has ≥3 paying federal customers and ≥6 months runway-safe revenue
- A customer asks "do you also do [policy tracking / permit roadmaps / RFP tracking]?" — first cross-sell demand signal
- ≥5 design partners reached and product-market fit feels stable
- Competitor announces a multi-product play and forces our hand
- Funding milestone (Series A) requires articulating the larger vision

## Open questions

- **Naming sequence.** Pick parent brand first then rename Auto Lobby to fit, or pick parent brand to match Auto Lobby's existing voice? Probably the former — parent brand is the bigger commitment.
- **Domain hunt.** Likely targets: .com + .ca, both. Trademark sweep CIPO + USPTO. Budget for premium domain if needed (parent brands sometimes warrant $5–25K acquisition).
- **Product naming convention.** Auto Lobby + Auto Permit + Auto Track? Or distinct names per product (e.g., parent = "X", products = "Lobby" / "Track" / "Map")? "Auto X" doesn't scale gracefully beyond compliance.
- **Sequencing the second product.** After Auto Lobby has paying customers, is Policy Track or Reg Map the right second product? Customer demand should dictate.
- **Open-source angle.** Some platform layers (Canadian DPOH registry, regulatory data feeds) might be more valuable as open data + ecosystem than proprietary moat. Open data lifts everyone, captures the position as the standard.
- **Branded vs. modular naming.** Some platforms work well with one parent brand showing through (Salesforce → "Sales Cloud, Marketing Cloud"). Others use family-of-brands (Microsoft → Word, Excel, PowerPoint). Which fits us better?

## Connection to the other parked docs

- **`Gov-Platform-Parked.md`** — the commissioner's-office product is itself a platform play; white-label / licensed motion. Same structural pattern.
- **`Agency-Motion-Parked.md`** — agencies will resell the entire portfolio, not just Auto Lobby. Each new product multiplies agency contract value.
- **`Calendar-Confirm-UX-Parked.md`** — multi-persona UX is platform-level, not Auto Lobby-specific. Future products inherit the registrant/lobbyist/coordinator pattern.
- **`Naming-Parked.md`** — scope expanded by this doc. Was "rename Auto Lobby." Now "establish parent brand + product-naming convention for a multi-product platform."

## Context for whoever resumes

- Idea logged 2026-04-30 by Jason (jason@deepskyclimate.com), founder of Deep Sky Climate, end-of-day after the agency-motion conversation surfaced multi-tier UX.
- Triggered by Jason's recognition that "Auto Lobby" is a great product name but a poor parent brand, and that the actual ambition includes legislative/regulatory monitoring + permitting roadmaps + likely several adjacent products.
- The ambition shift: from "lobbying compliance SaaS" to "regulatory operating system for Canadian regulated industries."
- Active recommendation: do **not** rename Auto Lobby tonight. Do **not** start brainstorming names tonight. Capture the shape (this doc), keep building Phase 2, return to the naming + brand exercise as a focused 2–3 day workstream once Phase 3 ships and ≥1 paying customer or design partner is under contract.
