# Auto Lobby — Claude Code brief

Read this file first every session.

## What this is

Automated Canadian lobbyist compliance. Federal (OCL) first, provincial + municipal later. Multi-tenant B2B SaaS; **Deep Sky** (climate / direct-air-capture) is the first user.

An agent runs continuously on the user's calendar, detects meetings with Canadian federal public officials, classifies whether each meeting is reportable lobbying, drafts the Monthly Communication Report (MCR) with all fields pre-populated, and surfaces one action once per month: the CEO certifies the batch, and the system submits via a supervised GCKey session to the Lobbyists Registration System (LRS). Target friction: ≤ 5 minutes of CEO time per month.

## Read these before writing code

- `Auto-Lobby-MVP-Roadmap.md` — full product plan, roadmap, monetization, competitive context
- `docs/Detection-Pipeline.md` — pipeline architecture, data model, anti-over-reporting rules
- `prototypes/Monthly-Certification.html` — the primary UX (the "one button per month" experience)
- `prototypes/File-Meeting.html` — subject-matter picker
- `prototypes/Meeting-Inbox.html` — passive activity log (demoted from primary UX)
- `prisma/schema.prisma` — starter data model, multi-tenant, event-sourced audit trail

Parked ideas (don't build, but check before making structural decisions that might foreclose them):

- `docs/Naming-Parked.md` — product name decision (resume after Phase 0 ships green)
- `docs/Gov-Platform-Parked.md` — potential second product for commissioner's offices (resume after ≥3 paying federal customers)

Build React components that match the prototypes visually. Inter font, emerald-700 accent, stone neutral palette, generous whitespace.

## Non-negotiable constraints

Never design around these.

1. **CEO certification is required for every filing.** The Lobbying Act requires the senior officer to personally attest. Nothing auto-submits without an authenticated click from the registrant.
2. **No credential custody.** We never store GCKey credentials. Submission uses a supervised Playwright session; the user authenticates in-session.
3. **No cross-tenant training.** Per-tenant classifier tuning only. Calendar content stays within the tenant.
4. **Explainable auto-decisions.** Every classification and pre-filled field carries provenance. The UI always shows *why*.
5. **Anti-over-reporting bias.** Domain match ≠ DPOH; DPOH ≠ reportable lobbying. Default to exclusion on low-confidence signals. Public consultations, procurement Q&A, and routine program inquiries are never auto-reported.
6. **Canadian data residency.** Everything in Canadian regions from day one. PIPEDA-compliant.

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

## Phase 2 — DPOH resolution + classifier (next)

Goal: identify which of the 1,469+ raw events involve a Designated Public Office Holder, classify reportable vs. non-reportable, write `DetectedMeeting` rows with provenance.

**Data sources to evaluate:**
- GEDS (Government Electronic Directory Services) — federal employees with positions
- parl.ca — MPs and Senators
- Treasury Board ministerial exempt staff lists

**First chunk likely:** institution + DPOH registry seeding. Start with cabinet ministers and their exempt staff plus senior bureaucrats (DM, ADM) at the top ~10 institutions Deep Sky engages — climate (ECCC), NRCan, finance, ISED, treasury, ag, transport, infrastructure, foreign affairs (GAC), industry.

Then: attendee-resolution service (email → institution → official → DPOH y/n with confidence + dpohBasis citation), classifier MVP (Lobbying Act s. 5(1) tests for oral, arranged-in-advance communication on a registrable subject), `DetectedMeeting` writes with `ClassificationReason` rows for every signal that drove the verdict.

Only after Phase 1 ships:
- DPOH resolution service (GEDS + Parliament + ministerial exempt staff)
- Classifier MVP
- Monthly Certification UI (match `prototypes/Monthly-Certification.html`)
- Playwright submission harness

## Out of scope

- Provincial + municipal filing integrations (deferred to Phase 7)
- Legislative intelligence / CRM / lobbyist-relationship tracking (stay in compliance lane)
- Grassroots / constituent engagement
- Mobile app

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
```
