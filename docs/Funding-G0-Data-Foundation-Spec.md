# Funding Navigator — Phase G0: Data Foundation (engineering spec)

> Implementation spec for the first chunk of Product 03. See `docs/Grants-Funding-Roadmap.md` for product context and `docs/Detection-Pipeline.md` for the data-ops patterns this mirrors.
>
> Last updated: 2026-06-19 · Status: ready to build (spike-corrected)

---

## Goal

Stand up the read-only data foundation every later phase consumes: a normalized **program catalog**, a historical **disbursement** corpus, a **structured eligibility-rule** schema, and a **form-coverage sample** that tells us how automatable applications actually are. No UI, no matching, no drafting in G0 — those are G1+. G0 is "get the data in, cleanly, idempotently, and prove the rule model holds."

**Definition of Done for G0:** federal catalog (filtered to federal + de-duped) + windowed disbursement history imported via idempotent scripts (TRUNCATE-in-transaction, DB-size logging); Prisma models migrated; eligibility-rule schema validated against ≥30 real programs **using the scraped-page extraction output** (not the bare feed — see G0c); form-coverage report committed; `pnpm lint && pnpm typecheck && pnpm test` green; import re-run lands the DB at the same size.

---

## Spike Findings (2026-06-19)

A throwaway data spike (`scripts/spike-funding-data.ts` — now **retained + corrected** as a reusable import smoke-test) inspected both feeds live before any build work. It **validated the `RuleDimension` schema** (kept as-is) but corrected five build assumptions, each threaded into the relevant section below. Headlines:

1. **Resource IDs resolve at runtime; pinned targets are tabled below.** [→ G0a, G0b]
2. **Catalog is all-levels, thin, and duplicate-laden** — 1,616 rows, only 397 federal, 10 free-text columns, no structured eligibility. Filter to federal, de-dup, drop non-funding. [→ G0a]
3. **The feed carries no eligibility criteria** — only benefit blurbs. Per-program-page scrape → LLM-parse is the **primary** extraction path, not a fallback; the `RuleDimension` schema is unchanged. [→ G0c]
4. **Disbursements: 1.3M rows, clean fuzzy join keys, but expect LOW catalog-match coverage** — design orphan-tolerant aggregates; don't gate the moat on join %. [→ G0b]
5. **Sizing: default window cut from "6 fiscal years" to "~3 years"** to fit Neon 0.5 GB alongside OCL. [→ G0b]

**Pinned CKAN resources.** Package IDs are stable; **resource IDs change on re-publish — always re-resolve via `package_show` at build time and record `sourceVersion`.** Targets verified 2026-06-19:

| Dataset | Package ID (stable) | Resource ID (2026-06-19) | Access |
|---|---|---|---|
| Catalog — Business Benefits Finder | `4e75337e-70d0-4ed7-92d1-3b85192ec6b1` | `d07f854d-1cac-4f18-b4f4-5b3c4c7ffa21` ("IC Programs and Services (2025 July)") | **XLSX, NOT in DataStore** → download + parse |
| Disbursements — Grants & Contributions | `432527ab-7aac-45b5-81d6-7597107a7013` | `1d15a62f-5656-49ad-8c88-f40ce689d831` | CSV, **DataStore-active** (~2.26 GB) |

> **Resource-selection trap:** `resources.find(r => r.datastore_active)` returns `4e4db232…` — the "…Nothing to Report" **nil** file (231 rows, org names only), NOT the disbursement data. **Select by resource identity** (the "Proactive Disclosure - Grants and Contributions" CSV / the large non-nil DataStore resource), never by the first `datastore_active` flag.
>
> **Bonus resources** on the disbursements package — use to validate field names/types: Data Schema (JSON) `d9fee653…`, Data Dictionary (XLSX) `87f0a925…`.
>
> **CKAN quirks observed:** `datastore_search_sql` → HTTP 400 (SQL endpoint disabled on open.canada.ca); `datastore_search` with `limit=0` + `filters` → HTTP 409. Use plain `datastore_search` with `limit`/`offset`; sample across offsets to estimate distributions.

---

## Sub-chunks (build + commit in order)

### G0a — Program catalog import (federal spine)

**Source.** Innovation Canada's Business Benefits Finder, package `4e75337e-70d0-4ed7-92d1-3b85192ec6b1` on open.canada.ca (CKAN). **The catalog is published as periodic XLSX file resources, NOT loaded into the DataStore** — resolve the latest XLSX via `package_show` (currently `d07f854d…`, "IC Programs and Services (2025 July)"), download its `url`, and parse the workbook. The CKAN action API is still the entry point; just expect a file download for this dataset, not `datastore_search`.

**What the spike found about the feed (this governs the Work below):**
- **1,616 program rows** (after dropping the EN + FR header rows), but it is an **all-levels directory, not a federal-only list**: only **397 (25%) are federal** (`Organization` starts "Government of Canada…"); the other **1,219 (75%) are provincial / territorial / municipal / funded-org**. **Do NOT treat 1,616 as the federal count.** (The 1,219 non-federal rows are a head-start on G2 coverage — don't import them as federal here, but they confirm G2's feed exists.)
- **Thin schema — 10 columns, all free text:** Title, Short Description, Long Description, Organization, Organization URL (each × EN/FR). **No structured instrument type, value, government level, or eligibility fields.** Instrument and value must be *derived* from the blurb (≈39% of rows carry an explicit `$`/`%`; instrument-type keywords appear on ~50%); store `null` when absent.
- **Duplicate-laden:** ~**203 near-identical "Cognit.ca | <institution>"** research-partner boilerplate rows, and ~**27%** are advisory/services rather than funding.

**Work.**
1. CKAN client in `src/server/funding/program-registry/ckan-client.ts` — typed `packageShow()` plus a **file-resource fetch + XLSX parse** path (`unzipper` + `fast-xml-parser`, both already dependencies), with retry and a recorded source version (resource `last_modified`). Keep a `datastoreSearch()` helper for G0b's DataStore pulls.
2. **Filter + de-dup before insert** (the count is not the catalog):
   - keep **federal only** for G0a (`Organization` starts "Government of Canada…") and tag `governmentLevel = federal`;
   - **de-dup** the "Cognit.ca | <institution>" boilerplate to a single canonical program;
   - apply an **is-this-actually-funding filter** — drop pure advisory/services rows, or tag `instrumentType = advisory` and exclude them from funding counts. Non-federal rows are deferred to G2; don't import them as federal.
3. Normalizer → `FundingProgram` rows: program name, funder, government level, instrument type (grant / repayable contribution / loan / loan guarantee / tax credit / wage subsidy / equity / advisory / in-kind) **derived from the blurb, `null` if unclear**, value range (parsed `$`/`%` where present, else `null`), intake cadence (continuous / window / first-come), source URL (the Organization URL — **also the G0c scrape target**), intake URL, raw eligibility text (the Long Description blurb).
4. De-dup on a stable natural key (funder + program slug); keep `FundingProgramSource` provenance per row.

**Anti-over-reporting analog applies hard here:** the feed states *benefits*, not *eligibility*, and rarely states instrument/value crisply. If the source doesn't clearly state an instrument type or value, store `null` + flag, never guess. Downstream eligibility must be able to say "unknown," not fabricate.

### G0b — Disbursement history import (the moat)

**Source.** Proactive Disclosure — Grants and Contributions, package `432527ab-7aac-45b5-81d6-7597107a7013`. The real data is resource **`1d15a62f…`** ("Proactive Disclosure - Grants and Contributions", CSV, DataStore-active, ~2.26 GB raw). **Select this resource explicitly — do not auto-pick the first `datastore_active` resource**, which is the `4e4db232…` "Nothing to Report" nil file. The spike confirmed **1,303,674 rows, 39 fields** of consolidated federal grants/contributions actually paid.

**What the spike found (this governs the Work below):**
- **Clean fuzzy join keys present:** `prog_name_en` (program name — **text, no numeric program ID**), `owner_org_title` (funder/institution), `agreement_value` (amount, text), `agreement_start_date` / `agreement_end_date`, `recipient_legal_name`, `recipient_province`, plus `naics_identifier` (sector) and `prog_purpose_en` (purpose). Validate field names/types against the Data Dictionary (`87f0a925…`) / Schema (`d9fee653…`).
- **The real date column is `agreement_start_date`** — there is no `fiscal_year` field on this resource (that belongs to the nil resource).

**Work.**
1. Reuse the CKAN client. Pull into `FundingDisbursement`: recipient name, recipient location, funder/institution (`owner_org_title`), program name (`prog_name_en`), agreement value, disbursement date (`agreement_start_date`), purpose (`prog_purpose_en`).
2. **Window the data deliberately — default: last ~3 years of `agreement_start_date` activity** (≈270–280k rows, est. **~130–180 MB indexed**). This fits the Neon 0.5 GB free tier alongside the OCL tables (~187 MB). The previously-proposed **"last 6 fiscal years" (~678k rows, ~330 MB data / ~450–500 MB indexed) does NOT fit.** **Measure real MB on the first import before committing the window** — the ~28% trim factor (keeping ~8 of 39 columns) is an estimate, not a measurement. If win-probability later needs deeper history, store **pre-computed per-program·sector·funder aggregates** rather than raw rows, or bump the Neon tier.
3. Fuzzy-join disbursements to `FundingProgram` by **`prog_name_en` + `owner_org_title`** (reuse the `pg_trgm` similarity approach from `lookup-official.ts`). **Expect LOW catalog-match coverage:** disbursement program names use paying-institution vocabulary, not the BBF marketing titles, and there are only 397 federal catalog rows against thousands of distinct disbursement program names. **Design orphan-tolerant** — unmatched disbursements keep the raw `programNameRaw` + funder + NAICS and still power sector/award-size aggregates. **Do not gate the moat on join %**; commit the measured matched-% as a metric, not a pass/fail gate. The disbursement corpus is independently valuable even fully unmatched.

This table powers win-probability and realistic award sizing in G3.

### G0c — Structured eligibility-rule schema

The hard problem — and the spike sharpened it: **the catalog feed carries no eligibility criteria at all.** Its descriptions are 1–2-sentence *benefit* blurbs ("Get a loan up to $350K…"), not eligibility specs. The real criteria live on each program's own page (the `Organization URL`). So eligibility extraction is a **scrape + parse** job, not a feed read.

**Keep the `RuleDimension` schema as specced — the spike validated it.** The 30-program hand-check confirmed that the criteria which *are* expressible map cleanly onto the dimension set (`sector`, `region`, `company_stage`, `headcount`, `revenue`, `incorporation_type`, `canadian_ownership_pct`, `project_type`, `eligible_cost`, `other`). The schema is right; the *source* was the problem.

**Design: scrape-primary, hybrid rule rows + a fit-assessment for the residue.**

- **Primary extraction path (re-sequenced):** for each federal `FundingProgram`, fetch its `Organization URL` page and **LLM-parse the eligibility section** into `EligibilityRule` rows — each a typed `dimension`, `operator`, `value`, `confidence`, and `source = llm_parsed`. Reuse the DPOH-registry scrape + verification patterns. The **bare feed yields only ~25–30%** of needed criteria (mostly `region` from the funder + coarse `sector`/instrument), so feed-only extraction is a *supplement*, not the path. Reserve `source = extracted_structured` for the few crisp feed-derived signals (e.g. region), and `manual` for hand-curation.
- Anything not reducible to a typed rule is retained as `narrativeCriteria` text, assessed at match time by an LLM "fit" call that **must cite the criterion it's reasoning over** and defaults to `verify` (not `eligible`) on ambiguity.

**Validation gate (the real G0c deliverable) — re-pointed:** hand-pick ≥30 programs spanning instrument types, extract rules **from the scraped-page output**, and confirm a human agrees with the structured representation. The **≥80% "crisp criteria reduce cleanly to typed rules" threshold is measured against the scraped-page extraction, NOT the bare feed** — the feed yields ~25–30% and *cannot* pass, and that is expected, not a schema failure. If the *scraped* extraction still misses 80%, revisit the dimension set before building the G1 engine on top of it; otherwise proceed.

**"Store null, never guess" applies hard:** when a page doesn't state a dimension, leave it unset and let `narrativeCriteria` + the verify-default carry it. Never synthesize a headcount / revenue / ownership threshold the source doesn't state.

### G0d — Form-coverage sample

Answers the open question that sizes the entire G4/G5 automation payoff: *what fraction of programs have a machine-fillable online portal vs. a downloadable PDF/Word form vs. email-only/none?*

- Sample ~50 programs weighted toward high-value/high-frequency ones (heavy on SR&ED-adjacent, regional development, provincial job grants).
- Classify each intake: `online_portal` / `fillable_pdf` / `static_pdf` / `email_or_offline` / `unknown`. Capture portal auth method (GCKey, provincial login, none) where it's a portal.
- Output: a committed `docs/Funding-Form-Coverage-Sample.md` table + a one-paragraph readout. This directly informs whether G4 drafting targets portals first or document packages first.

---

## Schema (additive — `prisma/schema.prisma`)

Reference tables follow the OCL pattern (read-only, idempotent import). Profile/project/assessment models are stubbed in G0 only as far as the rule schema needs; they're fleshed out in G1. **The `RuleDimension` set below is unchanged — the spike validated it; only the *extraction path* into these rows changed (see G0c).**

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

Re-running must land the DB at the same size, not accumulate. **Disbursement history is the size risk and the binding constraint** — the catalog (federal subset of a 458 KB XLSX) is trivial, but the disbursement table at the **~3-year default window** should land ≈130–180 MB (estimated). **Log MB on the first import and confirm it fits under 0.5 GB alongside OCL (~187 MB) before committing the window** — the trim estimate is unverified until measured.

---

## Out of scope for G0 (deferred to later phases)

- Provincial / municipal / funded-org catalog ingestion → **G2** (scrapers, no feeds — reuse DPOH-registry scrape + verification patterns). Note the BBF feed already carries ~1,219 non-federal rows, which de-risks G2's source but is *not* imported in G0.
- Matching/eligibility engine and ranked opportunities → **G1**.
- Win-probability, stacking engine, deadline radar → **G3**.
- Evidence vault, draft generation, budget builder → **G4**.

---

## Risks / things to watch

1. **CKAN resource churn + selection traps.** Resource IDs change on re-publish — always resolve via `package_show`, record `sourceVersion`, and pin the current targets (tabled in Spike Findings). **Never `find(datastore_active)` blindly** — it selects the "Nothing to Report" nil file for disbursements. The catalog is **file-download (XLSX), not DataStore**. `datastore_search_sql` is disabled (HTTP 400) and `datastore_search` `limit=0`+`filters` returns 409; page with `limit`/`offset`.
2. **open.canada.ca latency / throttling.** The disbursement endpoint is large and occasionally 409s under burst; paginate, back off on 409, and cache locally during dev rather than re-pulling each run.
3. **Disbursement table size vs. Neon budget — hard constraint.** Full set ≈1.3M rows / ~630 MB trimmed — over budget alone. **Default window is ~3 years (~130–180 MB indexed), not 6 fiscal years (~450–500 MB, over budget).** Measure MB before committing; fall back to pre-computed aggregates or a tier bump if deeper history is needed.
4. **Rule-extraction is scrape-primary.** The feed has no eligibility — extraction is per-program-page scrape → LLM-parse, and the G0c ≥80% gate is measured against *that* output, not the feed (~25–30%). If the scraped extraction fails the gate, the dimension set is wrong; fix it before G1, not after.
5. **Catalog completeness illusion.** G0a imports **federal only (~397 rows of the 1,616-row feed)** after de-dup/services filtering — the real distinct-federal-funding count is lower still. Funded-org and provincial programs (the bulk of "all levels," already visible as the feed's 1,219 non-federal rows) arrive in G2. Don't let G1's match quality be judged on federal-only coverage.

---

## Suggested commit sequence

1. `funding(g0a): CKAN client + XLSX parse + federal-filtered, de-duped catalog import + FundingProgram/Source models`
2. `funding(g0b): windowed disbursement import (resource 1d15a62f) + FundingDisbursement model + orphan-tolerant fuzzy program join`
3. `funding(g0c): EligibilityRule schema + scrape→LLM-parse extraction + 30-program validation gate (measured on scraped output)`
4. `funding(g0d): form-coverage sample + committed readout`
</content>
