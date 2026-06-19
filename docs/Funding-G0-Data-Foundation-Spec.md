# Funding Navigator — Phase G0: Data Foundation (engineering spec)

> Implementation spec for the first chunk of Product 03. See `docs/Grants-Funding-Roadmap.md` for product context and `docs/Detection-Pipeline.md` for the data-ops patterns this mirrors.
>
> Last updated: 2026-06-19 · Status: ready to build

---

## Goal

Stand up the read-only data foundation every later phase consumes: a normalized **program catalog**, a historical **disbursement** corpus, a **structured eligibility-rule** schema, and a **form-coverage sample** that tells us how automatable applications actually are. No UI, no matching, no drafting in G0 — those are G1+. G0 is "get the data in, cleanly, idempotently, and prove the rule model holds."

**Definition of Done for G0:** federal catalog + disbursement history imported via idempotent scripts (TRUNCATE-in-transaction, DB-size logging); Prisma models migrated; eligibility-rule schema validated against ≥30 real programs; form-coverage report committed; `pnpm lint && pnpm typecheck && pnpm test` green; import re-run lands the DB at the same size.

---

## Sub-chunks (build + commit in order)

### G0a — Program catalog import (federal spine)

**Source.** Innovation Canada's Business Benefits Finder, published as an open dataset on open.canada.ca (`4e75337e-70d0-4ed7-92d1-3b85192ec6b1`). open.canada.ca runs CKAN, so access is via the CKAN action API — never scrape the HTML when a feed exists.

- `GET https://open.canada.ca/data/api/3/action/package_show?id=4e75337e-70d0-4ed7-92d1-3b85192ec6b1` → resource list. **Resolve the current resource IDs at build time** (they change on re-publish; do not hard-code the ones in this doc).
- For tabular resources loaded into the DataStore: `GET .../action/datastore_search?resource_id=<id>&limit=...` (paginate via `offset`, or `datastore_search_sql` for filtered pulls).
- For file resources (XLSX/CSV): download the `url` from the resource and parse. Prefer DataStore when available; fall back to file download.

**Work.**
1. CKAN client in `src/server/funding/program-registry/ckan-client.ts` — typed `packageShow()` + `datastoreSearch()` with pagination, retry, and a recorded source version (resource `last_modified` / revision).
2. Normalizer → `FundingProgram` rows: program name, funder, government level (`federal` for G0a), instrument type (grant / repayable contribution / loan / loan guarantee / tax credit / wage subsidy / equity / advisory / in-kind), value range, intake cadence (continuous / window / first-come), source URL, intake URL, raw eligibility text.
3. De-dup on a stable natural key (funder + program slug); keep `FundingProgramSource` provenance per row.

**Anti-over-reporting analog applies even here:** if the source doesn't clearly state an instrument type or value, store `null` + flag, never guess. Downstream eligibility must be able to say "unknown," not fabricate.

### G0b — Disbursement history import (the moat)

**Source.** Proactive Disclosure — Grants and Contributions (`432527ab-7aac-45b5-81d6-7597107a7013`). Consolidated federal grants/contributions actually paid: recipient, amount, program, date, institution. CSV resources per the Treasury Board Policy on Transfer Payments; CKAN DataStore where loaded.

**Work.**
1. Reuse the CKAN client. Pull into `FundingDisbursement`: recipient name, recipient location, funder/institution, program name, agreement value, disbursement date, purpose.
2. **Window the data deliberately** — this is the large table (the OCL comm-report precedent is 2019+). Decide the window against the Neon 0.5 GB budget; default proposal: last 6 fiscal years. Log row counts and resulting MB.
3. Fuzzy-join disbursements to `FundingProgram` by program/funder name (reuse the `pg_trgm` similarity approach from `lookup-official.ts`). Unmatched disbursements stay as orphan rows with the raw program string — they still feed sector/award-size aggregates.

This table is what powers win-probability and realistic award sizing in G3. Get the join quality measured (matched %) and committed as a metric.

### G0c — Structured eligibility-rule schema

The hard problem. Program eligibility is part crisp filter, part narrative. The model must support both without overclaiming.

**Design: hybrid rule rows + a fit-assessment fallback.**

- `EligibilityRule` rows attached to a `FundingProgram`, each with a typed `dimension` (`sector`, `region`, `company_stage`, `headcount`, `revenue`, `incorporation_type`, `canadian_ownership_pct`, `project_type`, `eligible_cost`, `other`), an `operator`, a `value`, and a `confidence` + `source` (extracted-structured vs. LLM-parsed-from-narrative vs. manual).
- Anything not reducible to a typed rule is retained as `narrativeCriteria` text, assessed at match time by an LLM "fit" call that **must cite the criterion it's reasoning over** and defaults to `verify` (not `eligible`) on ambiguity.

**Validation gate (this is the real G0c deliverable):** hand-pick ≥30 programs spanning instrument types and levels, extract rules, and confirm a human agrees with the structured representation. If <80% of crisp criteria reduce cleanly to typed rules, revisit the dimension set before building the G1 engine on top of it.

### G0d — Form-coverage sample

Answers the open question that sizes the entire G4/G5 automation payoff: *what fraction of programs have a machine-fillable online portal vs. a downloadable PDF/Word form vs. email-only/none?*

- Sample ~50 programs weighted toward high-value/high-frequency ones (heavy on SR&ED-adjacent, regional development, provincial job grants).
- Classify each intake: `online_portal` / `fillable_pdf` / `static_pdf` / `email_or_offline` / `unknown`. Capture portal auth method (GCKey, provincial login, none) where it's a portal.
- Output: a committed `docs/Funding-Form-Coverage-Sample.md` table + a one-paragraph readout. This directly informs whether G4 drafting targets portals first or document packages first.

---

## Schema (additive — `prisma/schema.prisma`)

Reference tables follow the OCL pattern (read-only, idempotent import). Profile/project/assessment models are stubbed in G0 only as far as the rule schema needs; they're fleshed out in G1.

```prisma
model FundingProgram {
  id              String   @id @default(cuid())
  funder          String
  name            String
  governmentLevel GovLevel
  instrumentType  InstrumentType?      // nullable — never guessed
  valueMin        Decimal?
  valueMax        Decimal?
  intakeCadence   IntakeCadence?
  sourceUrl       String?
  intakeUrl       String?
  intakeFormType  IntakeFormType?      // set by G0d sampling where known
  narrativeCriteria String?            @db.Text
  rules           EligibilityRule[]
  sources         FundingProgramSource[]
  @@unique([funder, name])
  @@index([governmentLevel, instrumentType])
}

model EligibilityRule {
  id         String   @id @default(cuid())
  programId  String
  program    FundingProgram @relation(fields: [programId], references: [id], onDelete: Cascade)
  dimension  RuleDimension
  operator   RuleOperator
  value      String
  confidence Float
  source     RuleSource
  @@index([programId])
}

model FundingProgramSource {
  id            String   @id @default(cuid())
  programId     String
  program       FundingProgram @relation(fields: [programId], references: [id], onDelete: Cascade)
  feed          String   // "ckan:business-benefits-finder", "scrape:ontario", ...
  sourceVersion String?  // CKAN resource revision / last_modified
  fetchedAt     DateTime @default(now())
  @@index([programId])
}

model FundingDisbursement {
  id              String   @id @default(cuid())
  recipientName   String
  recipientRegion String?
  funder          String
  programNameRaw  String
  programId       String?  // fuzzy-joined to FundingProgram; nullable
  amount          Decimal?
  disbursedOn     DateTime?
  purpose         String?  @db.Text
  @@index([programId])
  @@index([funder])
}

enum GovLevel        { federal provincial municipal funded_org }
enum InstrumentType  { grant repayable_contribution loan loan_guarantee tax_credit wage_subsidy equity advisory in_kind }
enum IntakeCadence   { continuous window first_come closed }
enum IntakeFormType  { online_portal fillable_pdf static_pdf email_or_offline unknown }
enum RuleDimension   { sector region company_stage headcount revenue incorporation_type canadian_ownership_pct project_type eligible_cost other }
enum RuleOperator    { eq neq gte lte in not_in contains }
enum RuleSource      { extracted_structured llm_parsed manual }
```

Migration workflow per CLAUDE.md: hand-edit schema → `npx prisma migrate dev --name funding_g0_data_foundation` in dev → `migrate deploy` in CI/prod. Never `migrate dev` against prod.

---

## Idempotent import discipline (required — same as OCL)

Both import scripts (`scripts/import-funding-catalog.ts`, `scripts/import-funding-disbursements.ts`) follow the house pattern:

1. Log `[Step 0] Current DB size: X MB` via `pg_database_size(current_database())`.
2. Wrap the run in one `prisma.$transaction(async (tx) => { ... }, { timeout: 300_000, maxWait: 10_000 })`.
3. Inside: `TRUNCATE TABLE "FundingProgram", "EligibilityRule", "FundingProgramSource" RESTART IDENTITY CASCADE;` (and the disbursement table in its own script) before insert.
4. `try/finally` so `[Final] DB size: X MB` always logs.

Re-running must land the DB at the same size, not accumulate. Disbursement history is the size risk — measure it explicitly and tune the window in G0b before committing.

---

## Out of scope for G0 (deferred to later phases)

- Provincial / municipal / funded-org catalog ingestion → **G2** (scrapers, no feeds — reuse DPOH-registry scrape + verification patterns).
- Matching/eligibility engine and ranked opportunities → **G1**.
- Win-probability, stacking engine, deadline radar → **G3**.
- Evidence vault, draft generation, budget builder → **G4**.

---

## Risks / things to watch

1. **CKAN resource churn.** Resource IDs change on re-publish. Always resolve via `package_show`; record `sourceVersion`; alert on schema drift in the feed.
2. **open.canada.ca latency.** The dataset endpoints can be slow/large; paginate, stream, and cache locally during dev rather than re-pulling each run.
3. **Disbursement table size vs. Neon budget.** Hard constraint. The window decision in G0b is load-bearing — log MB before committing the default.
4. **Rule-extraction quality.** If the G0c validation gate fails (<80% clean reduction), the dimension set is wrong; fix it before G1, not after.
5. **Catalog completeness illusion.** The federal open dataset is the spine, not the whole picture — funded-org and provincial programs (the bulk of "all levels") arrive in G2. Don't let G1's match quality be judged on federal-only coverage.

---

## Suggested commit sequence

1. `funding(g0a): CKAN client + federal catalog import + FundingProgram/Source models`
2. `funding(g0b): disbursement import + FundingDisbursement model + fuzzy program join`
3. `funding(g0c): EligibilityRule schema + 30-program validation gate`
4. `funding(g0d): form-coverage sample + committed readout`
