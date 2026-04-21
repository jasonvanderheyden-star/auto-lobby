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

## Definition of Done

A feature ships when:
1. Types strict, Zod validates inputs
2. Unit tests cover happy path + at least one edge case
3. Auto-decisions log provenance
4. UI shows provenance where a user might reasonably ask "why?"
5. `pnpm lint && pnpm typecheck && pnpm test` all pass

## Phase 0 — starter tasks

Work in this order. Each is roughly a 2–4 hour unit. Ship one at a time; commit each.

1. **Bootstrap Next.js.** `npx create-next-app@latest` in this directory with App Router, TS, Tailwind, ESLint. Set up Prettier. First commit.
2. **Add Prisma + Neon.** Apply `prisma/schema.prisma`. Create a Neon project, set `DATABASE_URL`, run first migration. Prove connectivity with a trivial query on `Tenant`.
3. **Seed institution + gov-domain registry.** Write a seed script with the top ~30 federal institutions and their email domains. This is the foundation of detection.
4. **Import OCL open data.** Download registrations + MCRs CSVs from https://open.canada.ca. Load into a read-only `ocl_public_registration` table. Build a bare-bones `/registry-search` page. Roadmap milestone: "search the federal registry faster than the OCL's own site."
5. **Clerk auth + tenant scaffolding.** Wire Clerk. Every user belongs to a tenant. Tenant guard every query.
6. **Update CLAUDE.md** with any decisions made along the way.

Only after Phase 0 ships:
- DPOH resolution service (GEDS + Parliament + ministerial exempt staff)
- Google Calendar OAuth + ingestion
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
