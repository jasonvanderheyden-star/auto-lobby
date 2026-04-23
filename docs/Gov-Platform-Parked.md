# Future product — Gov-side lobbyist registration platform (parked)

Resume after Auto Lobby federal MVP is live with ≥3 paying design partners and ≥6 months of runway-safe revenue.

## The idea

Build a second product — a **white-label administrative platform** that a lobbying commissioner's office licenses and runs on their own government-hosted infrastructure. Same team, same codebase lineage, but shipped as a licensed software product (not SaaS we operate). Target buyers: the Office of the Commissioner of Lobbying (OCL) at the federal level, then provincial equivalents (Office of the Integrity Commissioner of Ontario, Commissaire au lobbyisme du Québec, etc.), then municipalities.

Commissioners today run legacy systems — manual intake, spreadsheet analytics, clunky public registries, inconsistent enforcement. Automating their side is a comparable software exercise to what Auto Lobby does for registrants: intake, validation, de-duplication, reporting dashboards, compliance-gap detection, enforcement workflow, public registry publishing.

## Why white-label, not SaaS-we-operate

Jason's correction (2026-04-22): this isn't a two-sided market we run. It's a govtech software product governments license and host themselves. That framing matters because:

- **Data sovereignty.** Commissioner's offices won't send filer data, enforcement cases, or public-registry records to a private vendor's cloud. Canadian governments strongly prefer on-premise or sovereign-cloud (PSPC / SSC-approved) deployments for regulatory systems.
- **Conflict-of-interest optics dissolve.** If we don't operate the gov side, we aren't simultaneously running both sides of a compliance exchange. We're just a software vendor — same as the company that sold OCL their current stack. No governance-structure gymnastics required.
- **Sales motion is a known pattern.** Government procurement of licensed + implementation-services software is well-understood (think OpenText, ServiceNow Public Sector, Granicus). The precedent and the procurement codes exist.
- **Licensing leverage on the registrant side comes from protocol, not hosting.** When a jurisdiction runs our admin platform, their ingest schema becomes the published standard. Auto Lobby files in that format. Any other filer-side tool has to match it too. That's the moat — a structured-filing standard we defined because we wrote both ends — without us having to host the government's data.

## Why it's strategically interesting

- **Interoperability step-change.** If both sides run our software, the filing loop becomes instant and structured — no form-filling, no OCR, no scraping. An Auto Lobby MCR certified by the CEO lands in the commissioner's inbox as an already-validated record. This is a step-change in end-to-end friction for *every* registrant in that jurisdiction, not just our customers.
- **Regulatory standardization.** A commissioner that adopts our gov-side can require electronic submission in our format, which makes filer-side tooling that matches our schema effectively mandatory.
- **Cross-jurisdiction moat.** Owning the administrative stack across federal + provinces + municipalities gives a vantage point nobody else has: comparative compliance data (published by commissioners, not by us), national trend detection, inter-jurisdictional lobbyist tracking.
- **Expansion playbook.** The federal pattern replicates for every province and — once proven — for other countries with comparable lobbying-transparency regimes (UK, Australia, Ireland, EU). Govtech is sticky once installed.

## Why it's hard

- **Sales cycle.** Government procurement is 12–24 months, RFP-driven, often requires security clearances, PSPC supply-arrangement qualification, or Canadian-owned vendor status. Completely different motion from B2B SaaS.
- **Jurisdiction-specific rebuild.** Each province has its own act, forms, DPOH definitions, exemptions, reporting cadences. Less code reuse than hoped — the core engine ports but the domain logic, forms, and enforcement rules are bespoke per jurisdiction.
- **Political risk.** A government change can stall or rescind contracts, especially on lobbying-transparency tooling.
- **Design-partner asymmetry.** Commissioners are slow-moving, risk-averse, and can't be moved by outbound the way a GR director can. Entry point is usually a published RFP or an existing supply arrangement, not a cold email.
- **Implementation services, not just software.** On-prem govtech deals carry substantial implementation + training + ongoing support obligations. Either we build that capability or partner with an SI (CGI, Deloitte, PwC, MNP Digital).

## Incumbent tech stack (what we'd be replacing)

Competitive intel captured 2026-04-22 from the live LRS site.

- **Framework:** Apache Struts 1.x. The URL pattern `lobbycanada.gc.ca/app/secure/ocl/lrs/do/<action>` uses the classic Struts action-servlet `.do` mapping. Struts 1 was declared end-of-life by Apache in **April 2013** — no upstream security patches for 12+ years.
- **UI skin:** GoC standard GCWeb / Web Experience Toolkit (WET).
- **Auth:** GCKey (federal SSO).
- **Data export:** flat CSV dumps on open.canada.ca, with the `Communication_SubjectMattersExport` file updated on a slower cadence than `Communication_PrimaryExport` (~18 month lag as of 2026-04-22). Suggests batch jobs, not a unified reporting layer.
- **Reliability:** the LRS landing page on 2026-04-22 carried a live banner — *"The Registry of Lobbyists is currently experiencing intermittent outages and may be temporarily unavailable."*
- **OCL IT budget:** ~$6.35M total for 2025-26, ~$4.35M for registration/education/compliance program. Multi-year carry-forward modernization funding exists — they're small and under-resourced, which rules out a big-bang in-house rewrite and makes a licensed replacement more attractive.
- **Vendor:** unidentified in public searches as of 2026-04-22. CanadaBuys site-search, Public Accounts of Canada, and lobbyist filings didn't surface a named LRS contractor. Definitive answer would come from an ATIP request to OCL.

**Implication:** the replatform conversation is not hypothetical at OCL — it's a roadmap item waiting for a credible path. Walking in with a working system (vs. a deck) is the differentiator.

## How it connects to Auto Lobby (the registrant side)

- **Phase 0–3:** registrant-side only. No conversations with commissioners.
- **Phase 4–5:** once Auto Lobby has paying design partners and a demonstrably smoother filing experience than what commissioners see today, open informal conversations with OCL staff — not to sell, but to learn. What would they wish filers did differently? What reporting burdens could be eliminated? What does their modernization roadmap actually say?
- **Phase 6+:** prototype gov-side admin UI with structured-filing ingest. Pitch as a pilot to OCL or one province. Engage an SI partner for implementation-services capacity.

## Triggers for revisiting

Pull this off the shelf when any of the following hit:

- Auto Lobby has ≥3 paying federal customers and ≥6 months of runway-safe revenue
- A commissioner's office approaches us unprompted (asking about data quality, filing format, etc.)
- A competitor announces a gov-side play and we need to respond
- A procurement RFP lands that's a natural fit (watch CanadaBuys for OCL + provincial integrity-commissioner postings)
- The LRS experiences a major security incident or extended outage — modernization urgency jumps

## Open questions

- Licensing model — perpetual + support, annual subscription, or managed-service hybrid?
- Delivery partner — build an implementation-services arm, or co-sell with an SI (CGI / Deloitte / PwC / MNP Digital) from day one?
- Is this a fit for non-dilutive government innovation funding (CDaP, ISED programs, NRC IRAP govtech angle)?
- Does the registrant side already generate data structured enough to drive the gov side, or would there be a separate ingest schema to co-design with commissioners?
- What would OCL staff actually find most valuable — modern UI, more automation, analytics, or just faster/cleaner data ingest?
- Which vendor(s) hold the current LRS contract? (ATIP request is the cheapest definitive answer.)

## Context for whoever resumes

- Founder is Jason (jason@deepskyclimate.com), Deep Sky Climate.
- Idea logged 2026-04-22 while Phase 0 of Auto Lobby just wrapped.
- White-label framing came from Jason's correction to the initial "two-sided market we operate" framing. The tech-stack intel was captured the same day from the live LRS site.
- Jason's intuition: government affairs issues unfold over multi-year arcs (see `docs/Detection-Pipeline.md` — OCL subject-matter lag note) — the same instinct applies here. A commissioner's office modernization is a multi-year arc, and the right time to enter the conversation is when the registrant side has enough proof to walk in with data, not pitch deck.
