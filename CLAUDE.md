# Auto Lobby — Claude Code brief

Read this file first every session. See also `docs/Project-Memory.md` for portable working memory (direction, dev toolchain, commit state).

## What this is

**Auto Lobby is the first product in a four-product Government Interface Platform.** The platform automates every touchpoint between a Canadian business and its government. "Auto Lobby" is a product name, not the parent brand — see `docs/Naming-Parked.md`.

**The four products (in build order):**
1. **Lobbying Compliance** (Auto Lobby) — detect calendar meetings with DPOHs, classify reportable lobbying, draft and certify Monthly Communication Reports, submit to LRS. *Current product — Phase 3 complete.*
2. **Government Intelligence & Monitoring** — Canada Gazette, OiC, committee proceedings, DPOH appointment alerts, consultation submission drafting, OCL competitive intelligence. *Next product after Compliance launch.*
3. **Grants & Funding Intelligence** — eligibility matching across 600+ federal programs, application draft generation, deadline tracking. *After Intelligence.*
4. **Regulatory & Permitting Roadmap** — multi-agency permitting matrix, sequenced roadmap with dependencies, condition tracking. *After Grants.*

**→ See `docs/Platform-Roadmap.md` for the full roadmap, phase table, sector priorities, and GTM strategy. Read it before making any architectural decisions.**

Auto Lobby in detail: An agent runs continuously on the user's calendar, detects meetings with Canadian federal public officials, classifies whether each meeting is reportable lobbying, drafts the Monthly Communication Report (MCR) with all fields pre-populated, and surfaces one action once per month: the CEO certifies the batch, and the system submits via a supervised GCKey session to the Lobbyists Registration System (LRS). Target friction: ≤ 5 minutes of CEO time per month.

## Read these before writing code

**Platform strategy (read first for any architectural or product decision):**
- `docs/Platform-Roadmap.md` — **canonical product roadmap, phase table, sector priorities, GTM** ← start here
- `docs/Platform-Roadmap-Strategy.docx` — formatted external version of the same (for sharing)

**Auto Lobby product detail:**
- `Auto-Lobby-MVP-Roadmap.md` — original product plan, monetization, competitive context
- `docs/Detection-Pipeline.md` — pipeline architecture, data model, anti-over-reporting rules
- `prototypes/Monthly-Certification.html` — the primary UX (the "one button per month" experience)
- `prototypes/File-Meeting.html` — subject-matter picker
- `prototypes/Meeting-Inbox.html` — passive activity log (demoted from primary UX)
- `prisma/schema.prisma` — starter data model, multi-tenant, event-sourced audit trail

Parked ideas (don't build, but check before making structural decisions that might foreclose them):

- `docs/Naming-Parked.md` — product name decision (resume once ≥1 paying customer is under contract)
- `docs/Platform-Vision-Parked.md` — original platform vision and architectural implications (superseded by `docs/Platform-Roadmap.md` for product decisions, but contains useful naming + brand notes)
- `docs/Gov-Platform-Parked.md` — potential product for commissioner's offices (resume after ≥3 paying federal customers)
- `docs/Agency-Motion-Parked.md` — GR-firm / law-firm white-label GTM motion (architectural implications are *not* parked — see non-negotiable #7 below)
- `docs/Calendar-Confirm-UX-Parked.md` — per-meeting attendee confirmation in the calendar app itself (Phase 4–5)

Build React components that match the prototypes visually. Inter font, emerald-700 accent, stone neutral palette, generous whitespace.

## Non-negotiable constraints

Never design around these.

1. **CEO certification is required for every filing.** The Lobbying Act requires the senior officer to personally attest. Nothing auto-submits without an authenticated click from the registrant.
2. **No credential custody.** We never store GCKey credentials. Submission uses a supervised Playwright session; the user authenticates in-session.
3. **No cross-tenant training.** Per-tenant classifier tuning only. Calendar content stays within the tenant.
4. **Explainable auto-decisions.** Every classification and pre-filled field carries provenance. The UI always shows *why*.
5. **Anti-over-reporting bias.** Domain match ≠ DPOH; DPOH ≠ reportable lobbying. Default to exclusion on low-confidence signals. Public consultations, procurement Q&A, and routine program inquiries are never auto-reported.
6. **Canadian data residency.** Everything in Canadian regions from day one. PIPEDA-compliant.
7. **Architect for both direct and agency GTM from day one.** Auto Lobby supports two go-to-market motions: direct (in-house GR teams at corporates) and agency (GR firms / law firms managing client portfolios under white-label). Don't build the agency UI yet, but never make a schema, permission, or audit decision that forecloses it. Concretely: `Tenant` carries a nullable `agencyId` foreign key, tenant-level branding hooks (`logoUrl`, `brandColor`, `productName`, `supportEmail`) are nullable but rendered through variables, and `AuditEvent` attribution supports "actor + actor_role + on_behalf_of_tenant." See `docs/Agency-Motion-Parked.md` for the full motion plan.

## Tech stack (decided — don't revisit without explicit reason)

- **TypeScript** strict mode everywhere. No `any` unless truly irreducible.
- **Next.js 15** App Router + React 19.
- **Tailwind CSS** 4. Match `prototypes/` aesthetically.
- **Postgres** via Neon (dev) and Neon / AWS ca-central-1 (prod). Multi-tenant via `tenant_id` + RLS.
- **Prisma** for all DB access. No raw SQL unless performance demands.
- **Clerk** for auth + tenant management. Do not build auth.
- **Inngest** for background jobs (durable, retry-safe).
- **Playwright** for LRS submission. Always supervised.
- **Zod** for all input validation — API routes, forms, env vars.
- **Claude API** (Anthropic SDK) for classifier + pre-fill. Structured outputs preferred.
- **Sentry** + Vercel logs. Add Logfire if Python services ever land.
- **Vercel** (Canadian region) for web. Railway or AWS ca-central-1 for background services.

## Project layout — start simple, split later

Begin as a single Next.js app with services as internal modules. Extract to separate packages only when (a) a service needs independent scaling, or (b) a service has non-Next dependencies. Don't pre-build monorepo complexity.

```
src/
  app/                # Next.js App Router routes
  components/         # React UI — match prototypes/
  server/
    ingestion/        # calendar connectors (Google, M365)
    dpoh-registry/    # institution + DPOH scraping + resolution
    classifier/       # lobbying vs. not-lobbying + pre-fill engine
    filing-engine/    # MCR drafting + state machine
    submission/       # Playwright against LRS
    audit-log/        # append-only event store
  lib/                # shared utilities
prisma/
  schema.prisma
```

## Coding conventions

- **Server Actions** for mutations; API routes for external webhooks.
- **Small files, single-purpose.** Split at ~300 lines.
- **Every auto-decision persists provenance.** Classifier writes `ClassificationReason` rows; pre-fill writes source tags on every field.
- **Event-sourced audit trail.** Every state change appended to `AuditEvent`. Never mutate history.
- **Per-tenant isolation always.** No query without an explicit `tenantId` scope. RLS backs this up.
- **No PII in logs.** Attendee names and emails are sensitive; log IDs, not content.

## Data operations

Neon free tier is 0.5 GB with a short PITR window. Every import or seed script must be idempotent — re-running it must land the DB at the same size, not accumulate.

**Idempotent import/seed pattern (required):**

1. At start, log `[Step 0] Current DB size: X MB` via `pg_database_size(current_database())`.
2. Wrap the whole run in a single `prisma.$transaction(async (tx) => { ... }, { timeout: 300_000, maxWait: 10_000 })`.
3. Inside the transaction, TRUNCATE the target tables before inserts: `TRUNCATE TABLE "<table_a>", "<table_b>" RESTART IDENTITY CASCADE;`.
4. Wrap in `try/finally` so `[Final] DB size: X MB` always logs, even on failure.

**Migration workflow:**

- Hand-edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <desc>` in local dev to generate SQL + apply.
- Production / CI runs `npx prisma migrate deploy` only — never `migrate dev`.
- `DATABASE_URL` points at the pooled Neon endpoint (`-pooler` host). `DIRECT_URL` points at the non-pooled endpoint; Prisma uses it for migrations.
- Never run raw SQL against prod without a migration file committed to the repo first.

**OCL public data (read-only reference tables):**

- `ocl_public_registration` holds the **full historical** registration set (~170k rows) — needed for cross-referencing older filings.
- `ocl_public_communication_report` is **filtered to 2019+** (~215k rows) — pre-2019 MCRs are skipped, they're not useful for our detection window.
- Full import lands at ~187 MB. Budget accordingly when adding tables.

## Auth + webhooks

**Clerk Organizations map 1:1 to Tenant rows.** `clerkOrgId` on `Tenant` is the stable join key. The webhook handler at `/api/webhooks/clerk` upserts on `organization.created` and `organization.updated`. Signature verification uses svix with `CLERK_WEBHOOK_SECRET`.

**Gotchas learned in dev:**

- **Webhook URLs must include the full path.** Register the Clerk webhook endpoint as `https://<tunnel>/api/webhooks/clerk` — not just the domain root. If only the domain is registered, Clerk POSTs to `/`, gets a 200 from the landing page, and marks the delivery "Succeeded" in its UI even though the handler never ran. Always verify the full URL after registration.
- **ngrok free URLs change every session.** Re-register the webhook in the Clerk dashboard each dev session, or pay for a reserved ngrok domain. Alternatively use Clerk's own dev tunnel: `npx @clerk/agent tunnel 3000`.
- **Clerk webhooks don't replay past events.** If orgs are created before the webhook endpoint is reachable, run `npm run tenants:backfill` to sync them (see `scripts/backfill-tenants.ts`).

## Definition of Done

A feature ships when:
1. Types strict, Zod validates inputs
2. Unit tests cover happy path + at least one edge case
3. Auto-decisions log provenance
4. UI shows provenance where a user might reasonably ask "why?"
5. `pnpm lint && pnpm typecheck && pnpm test` all pass

## Phase 0 — starter tasks

Work in this order. Each is roughly a 2–4 hour unit. Ship one at a time; commit each.

1. ✅ **Bootstrap Next.js.** `npx create-next-app@latest` in this directory with App Router, TS, Tailwind, ESLint. Set up Prettier.
2. ✅ **Add Prisma + Neon.** Apply `prisma/schema.prisma`. Neon project provisioned; `DATABASE_URL` + `DIRECT_URL` set; migrations applied.
3. ✅ **Seed institution + gov-domain registry.** Top ~30 federal institutions + email domains seeded. Foundation of detection.
4. ✅ **Import OCL open data.** Registrations + comm reports loaded from open.canada.ca; idempotent import script with TRUNCATE-in-transaction and DB-size logging (see Data operations). `/registry-search` page live.
5. ✅ **Clerk auth + tenant scaffolding.** Clerk provider + middleware wired. Webhook handler at `/api/webhooks/clerk` upserts Tenant rows on `organization.created/updated`. Tenant context helper (`getTenantContext`, `withTenant`, `tenantScopedPrisma`) in `src/server/tenant/context.ts`. Dashboard proves end-to-end sync.
6. ✅ **Update CLAUDE.md** with any decisions made along the way.

**Phase 0 is complete.**

## Phase 1 — Calendar ingestion (complete)

7. ✅ **Google Calendar OAuth + ingestion.** Connect a Google Calendar, ingest events, feed the detection pipeline.

Shipped in four chunks:

- **Chunk 1** (`f8d45ce`): schema migration for `CalendarConnection` + `RawCalendarEvent`, AES-256-GCM token encryption (`src/server/crypto/tokens.ts`), Zod-validated Google + encryption env vars.
- **Chunk 2** (`b75a0b4`): Google OAuth start route + callback with 7-error branching, CSRF-safe state cookie (encrypted, 10-min TTL, SameSite=Lax), Settings UI at `/settings/calendars`. First Deep Sky calendar connected end-to-end.
- **Chunk 3A** (`661472a`): Inngest SDK install, `/api/inngest` route, client at `src/lib/inngest.ts`, middleware updated to allow Inngest path through Clerk.
- **Chunk 3B** (`d5741e7`): Google Calendar API client at `src/server/google/calendar-client.ts` with proactive token refresh (5-min buffer), `CalendarAuthError` taxonomy, marks connection `token_refresh_failed` on failure.
- **Chunk 3C** (`fe15886`): Inngest polling worker — cron `*/15 * * * *` fans out one event per active connection, per-connection sync fetches with `syncToken` (incremental) or `timeMin/timeMax` (full), upserts to `RawCalendarEvent` keyed on `[connectionId, externalId]`, persists `syncToken` and `lastSyncedAt`. Handles `410 Gone` (expired sync token) by clearing and falling back to full sync next run.
- **Chunk 4** (`b885b44`): settings page polish — relative-time helper ("Synced X minutes ago"), `Sync now` server action that queues an Inngest event, `Reconnect` button on `token_refresh_failed` connections.

**Outcome:** 1,469+ events ingested for Deep Sky on first run. Incremental sync working, reconnect flow live.

## Phase 1 known issues / dev quirks

- **Google OAuth refresh tokens expire after 7 days** for apps in "Testing" publishing status. Users hit `token_refresh_failed`; the Settings page Reconnect button handles it. Long-term fix: publish the OAuth app for verified status.
- **Inngest cron only fires** when `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` is running in a separate terminal during local dev. Production will use Inngest Cloud — `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` replace `INNGEST_DEV=1`.
- **Server-action "Sync now" gives no visual feedback** — the click queues an Inngest event but the UI doesn't show a "Syncing..." state. The actual `lastSyncedAt` updates a few seconds later when the worker finishes. Backlog: add an optimistic syncing badge.
- **Wide-net ingestion is by design.** All calendar events ingest into `RawCalendarEvent` regardless of whether they involve government attendees. Filtering happens at Layer 2 (DPOH classification → `DetectedMeeting`). See "Anti-over-reporting bias" in non-negotiable constraints — the principle applies to *reporting*, not ingestion. Wide ingestion is needed for threshold accounting (denominator) and audit-trail negative evidence ("we considered this and excluded it").

## Phase 2 — DPOH resolution + classifier (complete)

Goal: identify which of the 1,469+ raw events involve a Designated Public Office Holder, classify reportable vs. non-reportable, write `DetectedMeeting` rows with provenance.

**What shipped:**

> Note: there is no Chunk 2a commit. The authoritative current-official seed (cabinet ministers, MPs/Senators, DMs/ADMs from GEDS/parl.ca/TBS) was the intended first chunk but was skipped. The OCL extraction below served as the bootstrap instead.

- **Chunk 2b** (`9f4c7f2`): ~42k historical officials extracted, canonicalized, and deduplicated from `OclPublicCommReport`. Source: `resolvedFrom = 'ocl-comm-reports'`, confidence 0.7, **no email addresses**. Auto-grew +108 institutions for names that didn't match the seed list.
- **Chunk 2c** (`119701b`, `5941691`): Attendee resolution service (`src/server/dpoh-registry/resolve-attendee.ts`) — email → domain → institution → named official → DPOH y/n, with confidence + `dpohBasis` citation. Anti-over-reporting bias applied: institution-domain match alone does **not** produce a DPOH signal; a named official match is required.
- **Chunk 2d** (`58612de`): Classifier MVP (`src/server/classifier/`) — Lobbying Act s. 5(1) tests for oral, arranged-in-advance communication on a registrable subject. Writes `DetectedMeeting` + `ClassificationReason` rows for every signal.
- **Chunk 2e** (`e8b2ad8`): Backfill run across 4,188 ingested events. Result: **1 lobbying / 32 needs-info / 4,155 not-lobbying**.
- **Chunk 2f**: Cabinet ministers + parliamentary secretaries seeded from `canada.ca/en/government/ministers.html`. `resolvedFrom = 'manual-ministers'`, confidence 1.0. `canonicalizeName()` extended to strip "The Honourable" / "Honourable" prefixes.
- **Chunk 2g**: Current MPs seeded from ourcommons.ca XML feed; senators from sencanada.ca Umbraco AJAX endpoint. `resolvedFrom = 'parliament'`, confidence 0.95.
- **Chunk 2h / 2h.5**: Deputy Ministers seeded from GEDS curated listing (`pgid=016&fid=11`); Assistant + Associate Deputy Ministers via GEDS advanced title search (`pgid=010 → pgid=011`). Two-step bcrypt-token fetch pattern. `resolvedFrom = 'geds'`, confidence 0.95. Shared HTTP helpers extracted to `src/server/dpoh-registry/geds-http.ts`.
- **Chunk 2i** (`cfd2762`): Ministerial exempt staff seeded via GEDS org-tree traversal — search minister by name → person page breadcrumb → ministerial office org unit → direct reports + one level of sub-orgs. `resolvedFrom = 'tbs-exempt'`, confidence 0.9, `dpohBasis = position-designation`, DPOH Regs Item 11. Result: **178 staff across 16 ministerial offices**. 11 skipped: 6 not in GEDS (political appointments without public service records), 5 ambiguous common names.
- **Chunk 2j** (`0b831f0`): Backfill re-run across all 10,130 events + targeted re-classification of needs-info events. Final result: **1 lobbying / 19 needs-info / 10,095 not-lobbying** across 10,130 events. The 19 residual needs-info are a hard floor — contacts below current registry coverage or display-name mismatches not resolvable by exact matching.

**resolvedFrom namespaces and confidence levels:**
- `ocl-comm-reports` — 0.7 — historical OCL filings, no emails, ~42k rows
- `manual-ministers` — 1.0 — cabinet ministers + parliamentary secretaries (canada.ca)
- `parliament` — 0.95 — current MPs (ourcommons.ca) + senators (sencanada.ca)
- `geds` — 0.95 — DMs + ADMs (GEDS curated listing + title search)
- `tbs-exempt` — 0.9 — ministerial exempt staff (GEDS org-tree traversal)

**Phase 2 is complete.**

## Phase 3 — Monthly certification UI (complete through chunk 3e)

Goal: surface classified meetings in a certification-ready UI, allow the CEO to review, confirm DPOHs, exclude non-lobbying meetings, and certify the batch, backed by an append-only audit trail.

**What shipped:**

- **Chunk 3a** (`99d1e59`): Filing engine at `src/server/filing-engine/generate-draft-mcr.ts` — generates `DraftMCR` rows from classified `DetectedMeeting` rows with field-level provenance on every pre-filled value.
- **Chunk 3b** (`a84acf9`): Monthly certification UI at `/filings` — 33 DraftMCRs rendered, expandable rows with provenance display. Matches `prototypes/Monthly-Certification.html` visually.
- **Chunk 3c** (`ffb7b59`): Confirm DPOH / exclude / certify server actions with cascading re-classification. Audit trail written inline in actions (not via a dedicated `audit-log/` service — see Known gaps).
- **Chunk 3c-polish** (`a7170f9`): Attendee layout — priority group on top, external tail in 3-column grid.
- **Chunk 3d-polish** (`0f1bf17`): Status/classification orthogonality, `useFormStatus` pending state.
- **Fix** (`435c1c1`): Remove `isDpoh` `orderBy` on nullable boolean (runtime Prisma error on `/filings`).
- **Chunk 3e** (`c130f9d`): OCL history hints for needs-info gov attendees — surfaces historical comm-report data in the UI to help identify unknown officials.

**Phase 3 is complete.**

## Phase 4 — LRS Playwright submission harness (complete)

Goal: submit certified MCRs to the Lobbyists Registration System (lobbycanada.gc.ca) via a supervised headed Playwright browser. The registrant authenticates manually — we never store credentials.

**What shipped:**

- `src/server/submission/types.ts` — `LrsSubmissionPayload`, `LrsDpoh`, `LrsSubjectDetail`, `SubmissionResult` types.
- `src/server/submission/prepare-submission.ts` — `prepareSubmissions(tenantId)` — queries certified-but-not-submitted `DraftMcr` rows, resolves DPOHs via `PublicOfficial`, splits names (last-space rule), builds institution labels as "Name (ACRONYM)", returns `LrsSubmissionPayload[]`.
- `src/server/submission/lrs-playwright.ts` — `submitBatchToLrs(payloads, onStatus)` — opens headed Chromium, waits for user login, walks each MCR through the LRS pre-flight → date modal → DPOH modal(s) → subject checkboxes → review → Certify modal flow. Stops batch on first failure.
- `scripts/submit-to-lrs.ts` — runnable entry point. Reads `TENANT_ID` from env, calls `prepareSubmissions`, calls `submitBatchToLrs`, writes `submittedAt` + `lrsReceiptId` to `DraftMcr`, appends an `AuditEvent`.
- `src/app/filings/_actions.ts` `certifyBatchAction` — updated to include `nextStep` hint in the audit payload pointing to the submit script.

**Running LRS submission:**

```bash
# Ensure Playwright Chromium is installed (one-time):
npx playwright install chromium

# Submit all certified, unsubmitted MCRs for a tenant:
TENANT_ID=<tenant-id> npm run lrs:submit
```

Or directly:
```bash
TENANT_ID=<id> npx dotenv-cli -e .env.local -- npx tsx scripts/submit-to-lrs.ts
```

**What the registrant does each month:**
1. Review and certify in `/filings` (web app).
2. Run `npm run lrs:submit` — headed Chromium opens lobbycanada.gc.ca.
3. Sign in to LRS in the browser (username → Continue → password → Sign in).
4. For each MCR, enter LRS username + password at the Certify modal, click Certify.
5. The script detects the green success banner, writes the communication number to `DraftMcr.lrsReceiptId`, and moves on.

**Non-negotiables honoured:**
- Headed browser only — `headless: false` is hardcoded.
- We never auto-click Certify — user must do it themselves.
- No credentials stored anywhere.

**Known gaps / Phase 5 polish:**
- Subject matter checkbox matching is by position (all checked) in Phase 4. In Phase 5 we will match by OCL code against the registration's actual checkbox labels.
- The government institution dropdown selector falls back to name-only (strips acronym) if the exact "Name (ACRONYM)" label doesn't match — manual verification recommended on first run.
- If the LRS HTML changes, the selectors in `lrs-playwright.ts` may need updates. The `fillField()` helper uses three fallback strategies to reduce fragility.

**Phase 4 is complete.**

## Phase 5 prep — multi-tenant launch readiness (in progress)

Goal: close architectural gaps and build the infrastructure required to charge customers and onboard a second tenant.

**What shipped:**

- **Chunk 5a**: Dedicated audit-log service at `src/server/audit-log/append.ts` — exports `appendAuditEvent()`, typed `AuditAction` union, `ActorRole` union, optional `tx` param for use inside Prisma transactions. `AuditEvent` schema extended with `actorRole` (nullable) and `onBehalfOfTenantId` (nullable) for agency GTM. Migration `20260522145845_add_audit_actor_role`. All inline `db.auditEvent.create()` calls replaced throughout `src/`. **Run `npx prisma migrate dev` + `npx prisma generate` locally before next dev session.**

- **Chunk 5b** (`pending migrate`): Fuzzy name matching — new `src/server/dpoh-registry/lookup-official.ts` extracts and upgrades both lookup functions. Two-pass strategy: (1) canonicalize via `canonicalizeName()`, (2) exact case-insensitive match, (3) pg_trgm `similarity() >= 0.45` fallback for accents/initials/middle names. New `DpohMatchSource` value `"name-fuzzy-at-institution"` for provenance. Fuzzy hits get `confidence × 0.85`. Migration `20260522175735_enable_pg_trgm` adds the extension + GIN index. **Run `npx prisma migrate deploy` (or `migrate dev`) locally, then `pnpm typecheck`.**

**What's next in Phase 5 prep:**
- Chunk 5c: Annual registration renewal automation
- Chunk 5d: Tenant entitlements groundwork (for multi-product platform)

## Phase 6 — Two-motion productization (built 2026-06-10, pending local migration)

Firms are piloting — the agency motion is **unparked**. The platform now supports two sequences:

**Use case 1 — In-house tenant** (Deep Sky model): multiple calendar contributors, role-gated certification. `TenantMember` carries additive roles (`admin | contributor | reviewer | certifier`). Only a `certifier` (the Responsible Officer) can certify; reviewers triage. First sign-in to a pre-roles tenant bootstraps that user with full roles (audited); invited Clerk org members are auto-provisioned WITHOUT certifier.

**Use case 2 — Firm/agency**, three sub-flows:
- **2a Consultant filings**: consultant calendars live in the firm's own tenant (`isAgencyOwnTenant`). `Engagement` models the undertaking (firm × client × registration) with attribution signals (clientDomains, subjectKeywords, keyInstitutions). The suggestion engine (`src/server/engagements/suggest-engagement.ts`) proposes a client per meeting (threshold ≥ 0.5, margin ≥ 0.2, full per-signal provenance in `engagement-suggested` audit events); the consultant confirms in /filings. **Auto-suggested attributions never enter a filing batch** (anti-over-reporting). Batches group by (consultant, engagement); `certifyConsultantBatchAction` requires the consultant of record.
- **2b Managed clients**: agency staff (AgencyMember admin/staff) prepare drafts on the client tenant (`actorKind: "agency"` in TenantContext — mapped to reviewer/admin, **never certifier**), then route for certification: single-use 256-bit token (SHA-256 hash stored, 14-day TTL), public page at `/certify/[token]` where the client RO reviews, attests, types their name, certifies. Agency workspace at `/agency`. No transactional email yet — the staffer copies the link.
- **2c Firm's own filing**: ordinary in-house tenant owned by the agency.

**Calendar providers**: Google + Microsoft 365 (Entra OAuth at `/api/oauth/microsoft/*`, Graph `calendarView/delta`, refresh-token rotation handled). Provider dispatch in `src/server/calendar/sync.ts` via `SYNC_PROVIDERS` record.

**New schema** (chunk 6a): `Agency`, `AgencyMember`, `TenantMember`, `Engagement`; `Tenant.agencyId/isAgencyOwnTenant` + branding fields; `DetectedMeeting.engagementId/engagementSource/engagementConfidence`; `DraftMcr` routing fields. **Run locally before next dev session:** `npx prisma migrate dev --name agency_roles_engagements_routing && npx prisma generate && pnpm typecheck && pnpm test`.

**QA state**: typecheck clean against the new client (verified out-of-tree); 150/150 vitest tests pass (59 new under `tests/` covering role gates, attribution thresholds, token single-use, batch exclusion of unconfirmed attributions, context bootstrap). QA seed: `npm run qa:seed` (idempotent, upsert-based — never truncates shared tables) creates the Maple Leaf Strategies demo firm + NorthVolt managed client + engagements + synthetic events run through the real classifier. Env: `SEED_CLERK_USER_ID`, `QA_FIRM_ORG_ID`, `QA_CLIENT_ORG_ID`.

**Known gaps from Phase 6 QA (not yet fixed):**
- `confirmDpohAction` overwrites registry-sourced `PublicOfficial` rows in place (destroys geds/parliament provenance); reset then deletes the row. Should write a tenant-scoped override instead.
- `certifyRoutedBatchAction` reports the pre-read count, not the conditional update's `result.count` (tiny TOCTOU window); same pattern in `routeBatchForCertification`.
- `MonthGroup` deep-clones drafts via `JSON.parse(JSON.stringify())` per row.
- Consultant LRS submission uses the in-house Playwright walk; the consultant MCR form differs — needs its own selector pass before a real consultant filing.
- Transactional email for routed certification (deliberate: no new SaaS dependency without approval).

## Known gaps

Not deferred scope — real gaps that should be closed before the relevant phase is considered fully done.

1. ~~**Authoritative current-officials seed is unbuilt.**~~ **CLOSED** — All five sources now seeded: OCL comm-reports, cabinet ministers, MPs/senators, DMs/ADMs, ministerial exempt staff. See Phase 2 resolvedFrom table above.

2. **Champagne (Finance) exempt staff returns 0.** The Finance ministerial office org structure in GEDS nests staff deeper than one sub-org level. The current one-level traversal in `fetch-exempt-staff.ts` doesn't reach them. Fix: extend `fetchStaffForMinister` to traverse two levels deep for offices that return 0 people at the first level.

3. ~~**`src/server/audit-log/` is a placeholder.**~~ **CLOSED** — `appendAuditEvent()` service live in `src/server/audit-log/append.ts`. All inline writes replaced. `actorRole` + `onBehalfOfTenantId` fields added to `AuditEvent` for agency GTM.

4. **`src/server/submission/` is unbuilt.** The supervised Playwright-against-LRS submission harness is Phase 4+ scope and has not been started.

5. ~~**Name matching is exact (case-insensitive), not fuzzy.**~~ **CLOSED** — `lookup-official.ts` now runs a two-pass strategy: exact match first, then pg_trgm similarity fallback (≥ 0.45) for accents, initials, and middle name variants. Fuzzy matches tagged `"name-fuzzy-at-institution"` in provenance with confidence × 0.85. The 19 residual needs-info events should decrease after the migration is applied and a backfill re-run is done.

**What's next:** Phase 4 — LRS Playwright submission harness. Blocked on LRS web form screenshots from Jason's law firm. When screenshots arrive: map form fields, write Playwright selectors, build supervised GCKey/LRS submission harness in `src/server/submission/`.

After Phase 4: Phase 5 (multi-tenant launch + agency motion), then Phase 5.5 (Product 02 — Government Intelligence). See `docs/Platform-Roadmap.md` for the full sequence.

## Out of scope (current platform roadmap)

- Grassroots / constituent engagement
- Lobbyist relationship CRM or BD pipeline management
- Procurement compliance / ITB offset management
- Mobile app
- International markets (US FARA, UK register — future optionality only)

*Note: "Legislative intelligence" is **not** out of scope — it is Product 02 (Government Intelligence & Monitoring), planned for Phase 5.5. The prior framing is superseded by `docs/Platform-Roadmap.md`.*

## Ask before doing

- Changing tech stack
- Adding a SaaS dependency > $50/mo
- Introducing Turborepo / Nx before there are two apps
- Any flow that submits to OCL without CEO certification
- Anything that stores GCKey credentials server-side
- Exposing tenant data cross-tenant, even anonymized

## Environment

`.env.local` needs:
```
DATABASE_URL=
DIRECT_URL=            # for Prisma migrations
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
SENTRY_DSN=
MICROSOFT_CLIENT_ID=       # Entra ID app registration (optional until M365 connect is enabled)
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT=common    # Entra authority tenant; "common" = any org + personal accounts
MICROSOFT_REDIRECT_URI=    # e.g. https://<host>/api/oauth/microsoft/callback
```
