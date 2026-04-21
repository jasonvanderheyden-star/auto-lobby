# Auto Lobby — MVP Build Plan & Roadmap

**Author:** Jason (Deep Sky)
**Date:** April 20, 2026
**Scope:** Canadian federal lobbyist compliance (OCL), Deep Sky as v1 user, multi-tenant SaaS as v2
**Document status:** v0.1 — foundational plan, expect revisions after customer discovery

---

## 1. Executive Summary

Auto Lobby is an automated compliance platform for Canadian lobbyist registration and reporting. V1 is an internal tool for Deep Sky (a climate / direct-air-capture company) that drives our federal filings with the Office of the Commissioner of Lobbying (OCL). V2 is a multi-tenant B2B SaaS sold to in-house corporate and organization registrants across Canada.

**Why now.** As of January 19, 2026, OCL's new interpretation bulletin lowered the registration threshold from "20% of duties" to **8 hours of lobbying across all employees in any rolling 4-week period.** Practitioner firms (Gowling, BLG, Blakes) project a surge in first-time registrants — organizations that have never had to file before now need a system. Simultaneously, the 2023 Lobbyists' Code of Conduct added stricter gift/hospitality rules and grassroots disclosure requirements, increasing the cognitive load on compliance teams.

**Why it's a real product, not a script.** Canada has no dedicated SaaS competitor for OCL compliance. The incumbents are GR consultancies charging $5k–25k/month retainers and political-law firms billing $500–1,200/hr. That's the price umbrella. A purpose-built tool at $5k–12k ACV undercuts headcount replacement cost (a GR coordinator at $75k–$90k spends 10–30% of their time on filings — $10–25k of labour) while delivering better audit trails than a human.

**What "fully automated" actually means.** The Lobbying Act requires the senior paid officer (usually the CEO) to personally **certify** every filing. The OCL has no submission API, no OAuth, no delegated-filer model — authentication is GCKey. So "end-to-end automation" in this domain = automate detection, drafting, pre-fill, staging, reminders, and audit trail; the CEO clicks one button to certify and submit in an authenticated session. Design the whole product around making that one click trustworthy and frictionless.

---

## 2. Strategic Context

**Market gap.** No Canadian-native SaaS automates OCL filings. Quorum and FiscalNote serve US LD-2/LD-203 with a Canadian legislative-intelligence overlay, but neither treats OCL filings as a first-class feature. Opportunity to own the category.

**Tailwinds.**
- Jan 2026 threshold change (estimated ~75% reduction in trigger bar) → surge of new registrants who need tooling on day one, not year three.
- 2023 Code of Conduct → more rules to track, fewer safe defaults.
- Rising scrutiny of climate/energy lobbying specifically (Deep Sky's neighborhood).
- OCL publishes weekly open-data CSV dumps — rich substrate for benchmarking, network effects, and lead-gen.

**Headwinds.**
- Compliance buyers are conservative; they want references, not innovation.
- CEOs are the decision-maker for a tool that touches their personal legal liability — long sales cycle without a trusted referral.
- OCL is a single regulator; any hostile rulemaking can reshape the product overnight.
- Legal risk of being perceived as doing the registrant's job for them (mitigation: registrant-in-the-loop certification, documented audit trail).

**Deep Sky advantage as first user.** A real in-house corporate registrant means the product gets built against an actual compliance workflow — not a hypothetical. Every design decision is validated against "does this help Jason file correctly on the 15th without stressing the CEO?" That's the single most defensible moat an early-stage SaaS can have.

---

## 3. ICP and Jobs-to-Be-Done

**Primary ICP (v2):** In-house corporate registrants with 5–50 employees, 3–20 monthly communication reports (MCRs), no full-time GR compliance staff. Climate-tech, health-tech, fintech, AI — sectors that lobby but don't have a Hill+Knowlton relationship. Annual lobbying activity real enough to cross the new 8-hour threshold but small enough that retaining a firm is overkill.

**Secondary ICP:** In-house organizations (trade associations, NGOs) with similar profile.

**Tertiary (later):** Consultant lobbyist firms filing on behalf of many clients — highest filing volume, but more price-sensitive and more likely to have built internal tooling already.

**Top jobs:**
1. "Tell me when we've crossed the registration threshold so I don't file late."
2. "Capture every DPOH meeting my team has without me chasing them."
3. "Draft the MCR so the CEO spends 30 seconds reviewing, not 30 minutes."
4. "Remind the CEO to certify before the 15th."
5. "Give me an audit trail my outside counsel will sign off on."
6. "Keep my registration current without me thinking about it."

---

## 4. MVP Scope (v1: Deep Sky internal, end-to-end)

**Goal:** Deep Sky files every MCR and keeps the registration current with zero manual data entry other than the CEO's certification click.

### 4.1 In-scope for v1

1. **Calendar & email ingestion.** Pull meetings from the team's Google Calendar / Microsoft 365. Parse attendees, subjects, attachments. Flag any meeting where a Canadian federal DPOH is present.
2. **DPOH detection.** Maintain a rolling database of current DPOHs (deputy ministers, ADMs, chiefs of staff, minister's exempt staff, senators, MPs, etc.). Match attendee emails/titles against this list. This is the core technical moat: the DPOH list shifts constantly with cabinet changes and staff turnover.
3. **Subject-matter mapping.** Map free-text meeting agendas to OCL's controlled vocabulary (Environment, Energy, Industry, Science & Technology, Taxation, etc.). LLM-assisted, with a human override.
4. **8-hour threshold tracker.** Sum lobbying time across all Deep Sky employees in rolling 4-week windows. Alert when approaching 6 hours (early warning) and 8 (must-register).
5. **Draft MCR generation.** For each confirmed DPOH meeting, auto-draft the MCR record with date, DPOH names/titles, subject matters, institution, named lobbyists present.
6. **Monthly certification dashboard.** By the 5th of each month, present the CEO with all MCRs for the prior month, ready to review. CEO can edit, dismiss, or approve each.
7. **Supervised submission.** Launch a headless browser session with human-in-the-loop GCKey auth. CEO authenticates, the product auto-navigates LRS, fills forms, pauses for final review, then the CEO clicks "Certify & Submit" inside the LRS portal. Screenshot + DOM snapshot + timestamp captured as audit trail.
8. **Six-month certification tracker.** Calendar reminder + pre-drafted filing if no updates/MCRs have been filed in 5 months.
9. **Audit trail & export.** Every action logged. One-click export of a PDF/CSV pack for outside counsel or OCL inquiry.
10. **Policy-change feed.** Subscribe to OCL news, interpretation bulletins, and Commissioner decisions. Alert when a change affects Deep Sky's registration.

### 4.2 Explicitly out-of-scope for v1

- Provincial registries (Ontario, Quebec, BC, Alberta, etc.) — v3.
- Municipal registries (Toronto, Ottawa, etc.) — v4.
- Public affairs / legislative intelligence. Don't compete with Quorum on that axis; integrate with them later.
- Grassroots appeals / constituent engagement tracking. Nice-to-have but not a compliance blocker.
- CRM features. Stay in-lane: compliance, not relationship management.

### 4.3 Definition of done for v1

Deep Sky files March 2026 MCRs (due April 15) entirely through Auto Lobby with zero keystrokes outside the certify step, and outside counsel signs off on the audit trail.

---

## 5. V2 Scope (multi-tenant SaaS for other orgs)

**Goal:** Any Canadian in-house corporate registrant can onboard themselves in < 30 minutes and file their first MCR through Auto Lobby within 7 days.

### V2 additions on top of v1
- Multi-tenant data model with strict tenant isolation.
- Self-serve onboarding: connect calendar, import existing registration from OCL open data, configure employees.
- Role-based access: Registrant (CEO/senior officer), Compliance Manager, Viewer.
- Billing (Stripe) with subscription + usage tiers.
- White-labeled audit exports for the customer's counsel.
- Admin console for support and escalation.
- SOC 2 Type I readiness (needed to sell to public-company registrants).

### Not-yet
- Provincial filings: ship after v2 is stable. Each province is a separate system (Ontario Integrity Commissioner, Quebec Commissaire au lobbyisme, BC Lobbyists Registrar, Alberta Ethics Commissioner). Expect 2–3 months of integration work per province.
- Municipal: Toronto, Ottawa, Hamilton, Vancouver, Montreal have registries of varying sophistication. Defer.

---

## 6. Technical Architecture

### 6.1 High-level components

- **Ingestion service.** OAuth connectors for Google Workspace and Microsoft 365 (calendar + email metadata only, not bodies unless opted-in). Polling + webhooks.
- **DPOH registry service.** Scrapes + curates the DPOH list from Government Electronic Directory Services (GEDS), Parliament of Canada, ministerial staff appointments, and open-government directories. Updated daily. This is the single most valuable proprietary dataset in the product.
- **Classifier service.** LLM-backed classifier for (a) is this a lobbying meeting? (b) which OCL subject matters apply? Uses Claude Sonnet with prompt-pinned examples from the OCL open data corpus of accepted filings.
- **Filing engine.** Drafts the MCR record. State machine: `detected → drafted → in_review → certified → submitted → acknowledged`.
- **Submission automation.** Playwright-driven browser automation against the LRS portal. Supervised: user loads GCKey in the same browser context, automation handles navigation + form-fill, pauses for certification, captures submission receipt.
- **Audit log.** Append-only event store. Every state transition, every AI-generated draft, every human edit. Exportable.
- **Web app.** CEO-facing review and one-click certify. Compliance-manager-facing dashboard. Admin.
- **Policy feed.** RSS + scraper on lobbycanada.gc.ca news, commissioner's letters, Federal Court decisions tagged "Lobbying Act."

### 6.2 Stack recommendation

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node) for services, Python for LLM/classifier | Typescript end-to-end where possible; Python only for the classifier pipeline where its ML libraries are stronger. |
| Web | Next.js + React | Fast iteration, good Canadian hosting story (Vercel Canada regions). |
| DB | Postgres (Neon or Supabase) | Standard, JSONB for filing-record flexibility, Row-Level Security for multi-tenancy. |
| Browser automation | Playwright | Best headful/headed mix for GCKey-supervised flows. |
| Background jobs | Inngest or Temporal | Long-running, durable, retry-safe — critical for scheduled filings. |
| LLM | Claude via API | Canadian data residency story + strong on structured output. |
| Auth | Clerk or WorkOS | Skip the build-it-yourself auth; those hours go into the DPOH registry. |
| Audit log | Append-only Postgres table + S3 for evidence blobs | Keep it boring. |
| Observability | Sentry + Logfire | Cheap, good defaults. |

### 6.3 Data-residency and privacy

Canadian customers — especially public-sector-adjacent ones — will ask about data residency. Plan to host in Canadian regions (AWS ca-central-1 or Vercel / Neon Canada) from day one. PIPEDA compliance is table stakes.

### 6.4 Repo layout (starter)

```
auto-lobby/
├── apps/
│   ├── web/                    # Next.js app (review + certify UI)
│   └── admin/                  # internal ops console
├── services/
│   ├── ingestion/              # calendar/email connectors
│   ├── dpoh-registry/          # the moat
│   ├── classifier/             # Python, LLM pipeline
│   ├── filing-engine/          # state machine
│   └── submission/             # Playwright automation
├── packages/
│   ├── db/                     # Prisma schema + migrations
│   ├── ocl-client/             # wraps public data + submission
│   └── shared/                 # types, schemas
├── docs/
│   ├── ROADMAP.md              # this file
│   ├── architecture/           # ADRs
│   └── compliance/             # privacy, data handling, legal
└── CLAUDE.md                   # project instructions for Claude Code
```

---

## 7. Build Roadmap

Each phase ends with a concrete verifiable milestone. All timelines assume Jason as primary builder with Claude Code + occasional contract help.

### Phase 0 — Foundation (Weeks 1–2)
- Set up repo, CLAUDE.md, Postgres, Vercel deploy.
- Import OCL open-data CSVs into local Postgres. Build basic search UI over existing registrations and MCRs.
- Write the product's legal-posture memo: who certifies, who submits, what we log.
- **Milestone:** Jason can search the federal registry faster than the OCL's own site.

### Phase 1 — DPOH registry (Weeks 3–5)
- Build the DPOH scraper (GEDS, Parliament, ministerial staff).
- Manual curation pass for current DPOH list.
- Matching engine: given an attendee list (emails, names, titles), return DPOH flags with confidence.
- **Milestone:** Feed in Deep Sky's last 6 months of calendar invites; the system correctly flags every meeting we know was a DPOH meeting.

### Phase 2 — Ingestion + classifier (Weeks 6–8)
- Google Workspace OAuth + calendar sync.
- LLM classifier for subject matters, tuned on OCL filing corpus.
- 8-hour threshold tracker with email alerts.
- **Milestone:** By Friday of week 8, Deep Sky's rolling 4-week lobbying hours are accurate to within 15 minutes vs. manual timecard.

### Phase 3 — Filing engine + draft UI (Weeks 9–11)
- MCR draft generation.
- Review UI: list of pending MCRs, bulk-edit, per-record detail view.
- PDF + CSV export of draft pack for pre-certification review.
- **Milestone:** Deep Sky CEO reviews and approves May 2026 MCRs in < 10 minutes total.

### Phase 4 — Supervised submission (Weeks 12–14)
- Playwright against LRS. Start with a staging account if OCL provides one; otherwise, use Deep Sky's live account with extreme care.
- GCKey-in-the-loop flow. Captures evidence at every step.
- Fallback: generate a filled-PDF artifact that the CEO can submit manually if automation fails on a given filing.
- **Milestone:** Deep Sky files at least one full month of MCRs end-to-end through Auto Lobby. Outside counsel reviews audit trail and approves.

### Phase 5 — Hardening + second user (Weeks 15–20)
- Identify 2–3 friendly Canadian in-house registrants (climate, health-tech, AI) for design-partner trials at steep discount or free.
- Multi-tenant refactor. RLS in Postgres, tenant-scoped everything.
- Stripe billing.
- SOC 2 Type I kickoff (Vanta/Drata).
- **Milestone:** Second customer files their June 2026 MCRs through Auto Lobby.

### Phase 6 — Commercial launch (Weeks 21–28)
- Public landing page, pricing, self-serve onboarding.
- Content strategy: "The new 8-hour threshold, explained" → top-of-funnel. The legal-firm blog posts about the Jan 2026 change are already strong — ride their SEO wake with more practical, operator-focused content.
- Target 10 paying customers by end of week 28.
- **Milestone:** MRR > $5k CAD.

### Phase 7 — Provincial expansion (Months 8–14)
- Ontario first (largest provincial registry, cleanest system).
- Then Quebec (French-language requirements — nontrivial).
- Then BC, Alberta.
- Each province ships as a modular add-on, not a core-rewrite.

---

## 8. Monetization Analysis

The user asked me to help think this through. Here's an honest assessment of the options, what the evidence suggests, and a recommendation.

### 8.1 Option A — Pure SaaS subscription per org

**Shape:** $X/month per registrant org, tiered by registered employee count or filings volume.
**Benchmarks:** Vanta $7–25k ACV; Quorum $15–60k ACV; BGOV $6–10k/user/year.
**Suggested tiers:**
- **Starter** (single registrant org, ≤ 3 named employees, ≤ 5 MCRs/month): CAD $299/month ≈ $3,600/yr
- **Growth** (≤ 10 named employees, unlimited MCRs, audit exports): CAD $699/month ≈ $8,400/yr
- **Enterprise** (unlimited, SSO, SOC 2 evidence, priority support, outside-counsel package): CAD $1,800/month ≈ $21,600/yr

**Pros:** Predictable MRR, easy to forecast, standard B2B muscle memory. Maps cleanly to the comparables.
**Cons:** Starter tier may undercharge for value; Enterprise tier requires features you won't have at launch.

### 8.2 Option B — Usage-based (per filing)

**Shape:** Flat monthly floor + $Y per MCR filed + $Z per registration update.
**Example:** $99/month floor + $49/MCR + $199/registration.
**Pros:** Aligns cost to value; low-friction for orgs that file rarely; consultants with many clients scale naturally.
**Cons:** Compliance buyers hate usage unpredictability — they want a fixed line item in the budget. Finance teams push back hard.

### 8.3 Option C — Managed service + software

**Shape:** Software + a real human (you or a contractor) who reviews filings before CEO certification. Hybrid price: $1,500–3,500/month.
**Pros:** Higher ACV, sticky, solves the "I want a human I can call" objection. Undercuts law-firm rates by 3–5x.
**Cons:** Services don't scale linearly; you become a consulting firm, not a software company. Harder to raise on.

### 8.4 Option D — Freemium + open data play

**Shape:** Free lobbying-activity tracker + public-registry search; paid for filing automation + audit trail.
**Pros:** Top-of-funnel via the OCL open-data corpus. Makes you the default "OCL search" destination; every lead is pre-qualified.
**Cons:** Distraction risk — free users consume support.

### 8.5 Recommendation

**Start with a hybrid of A + D, and hold C in reserve for enterprise deals.**

Specifically:
- **Free tier:** best-in-class OCL registry search with benchmarking ("compare your subject matters to peer climate companies"). Zero filing capability. Lead-gen engine.
- **Paid tier:** single SKU at launch. **CAD $599/month** flat for in-house corporate registrants. Simple to sell, simple to bill, easy to justify to CFOs ($7.2k/yr < one month of a GR coordinator). All the filing automation lives here.
- **Enterprise add-on:** $1,500–2,500/month for SSO, SOC 2, priority support, outside-counsel review bundle.
- **Consultant lobbyist firm tier** (introduce after 20 direct customers): per-client pricing, e.g., $149/client/month with a volume cap.

Rationale: one SKU at launch beats three. The market has no anchor price because the category doesn't exist; you set the number. $599/month is aggressive enough to close self-serve, premium enough to signal quality. Raise it with every tenth customer.

### 8.6 Financial sketch (12-month post-launch)

Assuming Phase 6 commercial launch hits in Q4 2026 / Q1 2027:
- Month 1–3 post-launch: 10 customers × $599 = **$5,990 MRR / $72k ARR**
- Month 4–6: 25 customers + 2 enterprise × $2k = **$18,975 MRR / $228k ARR**
- Month 7–12: 50 customers + 5 enterprise + 1 consultant firm = **~$45k MRR / $540k ARR**

Entirely achievable given ~3,200 in-house corporate registrants federally and the incoming wave of new threshold-triggered registrants.

---

## 9. Legal & Compliance Guardrails

Non-negotiables for the product's architecture — not suggestions.

1. **CEO (registrant) certifies every filing.** Product never auto-submits without an attested click inside an authenticated session. This is the single most important design constraint.
2. **No credential custody.** Never store GCKey credentials server-side. Always user-in-the-loop auth. Make this a marketing feature.
3. **Append-only audit trail.** Every decision the system made, every human edit, every AI draft. Exportable. This is what outside counsel will want to see if the Commissioner ever asks.
4. **PIPEDA-compliant data handling.** Canadian residency from day one. Document data flows for privacy impact assessments.
5. **No advice.** The product is a tool, not counsel. UX should nudge users to their outside lawyer for interpretation questions.
6. **Regulatory monitoring.** Someone on the team (initially Jason) reads every OCL bulletin within 72 hours and updates the product's logic.
7. **Terms of service** explicit that the registrant is responsible for the accuracy of filings.

---

## 10. Risks & Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| OCL changes LRS portal and breaks automation | High | Robust Playwright retry + fallback to filled-PDF generation + human-attended submission. |
| OCL issues guidance discouraging 3rd-party filing tools | High | Build strong relationship with OCL early; consider a proactive briefing. Frame product as "registrant-operated, AI-assisted." |
| Deep Sky's filings exposed publicly reveal sensitive strategy | Medium | Everything filed with OCL is public anyway; this is a training issue, not a product issue. |
| GCKey flow changes / mandates MFA we can't script around | Medium | Keep auth supervised by user; no automation of authentication. |
| LLM misclassifies subject matters leading to misfiling | Medium | Always human-review; track classifier accuracy; fall back to conservative default categories. |
| SOC 2 required earlier than planned | Medium | Start Vanta in Phase 5. Don't wait. |
| Legal-firm competitor ships a white-label tool first | Low-Med | Win by being builder-first and cheaper; partner with one firm as "preferred tool." |

**Open questions to resolve in the next 2 weeks:**
- Does OCL provide any sandbox / staging LRS account for developers? (Ask directly.)
- Will Deep Sky's outside counsel sign off on the certification UX design before we build?
- What's the earliest Deep Sky registration filing where we can run the system in shadow mode?
- Any appetite from a GR firm (Impact, Summa, Earnscliffe) to pilot as a service layer on top of Auto Lobby?

---

## 11. Next Actions (This Week)

1. **Book 30 minutes with Deep Sky's outside counsel.** Walk them through the certification model. Get objections early.
2. **Email OCL stakeholder relations.** Ask: (a) is there a sandbox, (b) any public API roadmap, (c) any preferred-partner framework?
3. **Spin up the repo.** Next.js + Postgres + Playwright. Import OCL open data CSVs. First useful internal tool: a better OCL search than the OCL's own.
4. **Draft the DPOH data model.** Decide scraping targets (GEDS, Parliament, ministerial appointments) and update cadence.
5. **Land 3 potential design partners.** Warm intros to Canadian climate / health-tech / AI startups newly tripped by the 8-hour threshold.
6. **Write the first piece of SEO content:** "What Canada's new 8-hour lobbying threshold means for your startup." Publishes traffic while the product is being built.

---

## Appendix A — Key Source Facts

- Federal registrant population FY22–23: ~5,800 active registrations (~3,200 in-house corp, ~1,700 in-house org, ~900 consultant). Source: OCL Annual Reports.
- ~25,000–30,000 MCRs filed per year federally.
- Jan 19, 2026 threshold change: 8 hours across all employees in a rolling 4-week period (replacing the 20% rule).
- 2023 Code of Conduct: $40 per-instance / $200 annual gift-and-hospitality cap per official.
- Penalties: up to $200,000 and/or 2 years (indictment); 2-year lobbying ban for Code breaches.
- Deadlines: initial registration within 2 months of threshold; MCRs by the 15th of the following month; six-month certifications if no activity.
- Public registry: https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/guest
- Open data: https://lobbycanada.gc.ca/en/open-data/
- Lobbying Act: https://laws-lois.justice.gc.ca/eng/acts/l-12.4/FullText.html

## Appendix B — Competitors at a Glance

- **Canada:** No dedicated SaaS. GR consultancies (Impact, Summa, Earnscliffe, Crestview, H+K Canada, Counsel PA) bundle compliance into $5–25k/mo retainers. Law firms (Gowling, McMillan, Fasken, Norton Rose, BLG, Blakes) at $500–1,200/hr.
- **US adjacents:** Quorum ($15–60k ACV, weak on OCL), FiscalNote/CQ (legislative intel, not filing), BGOV ($6–10k/user, no filing).
- **Horizontal risk:** OneTrust has a US-focused Political Activity module; watch for Canadian expansion.
