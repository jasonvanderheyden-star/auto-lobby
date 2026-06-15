# Phase 6 QA Walkthrough — Findings

**Date:** 2026-06-15
**Driver:** Claude (browser walkthrough via Claude in Chrome)
**Tester account:** jason@deepskyclimate.com (`user_3CgrViomL5xFrbhG4GUdGqOXTQi`)
**Build:** Next.js 15.5.19, migration `agency_roles_engagements_routing` applied, 150/150 unit tests green, typecheck + lint clean.

## Scope

Four personas were targeted: in-house RO (Deep Sky), agency consultant (Maple Leaf), agency staff routing a managed client, and the client RO certifying via a routed link. The tester login is bound to the **consultant**, so the in-house and consultant flows were driven live; the routing/public-cert flow was verified by code + tests (the live route was correctly blocked by server-side authorization — see Finding 2).

## Verified live (browser)

**Auth + tenant mapping.** Signed-out access to `/filings` correctly redirected to Clerk sign-in (dev instance). The dashboard cleanly renders the Clerk identity (user + org) mapped to the Deep Sky tenant row — Clerk→Tenant sync working.

**In-house RO certification (Deep Sky).** The filings dashboard shows the batch stats (10,130 events scanned, 75 gov attendees, 7 DPOHs, 6 lobbying) and groups MCRs by month. Expanding a "needs input" meeting shows attendees grouped (Your Team / Government — Status Unknown / Not a DPOH / Other), with per-attendee `✓DPOH` / `Not DPOH` toggles and provenance:

- The "WHY WAS THIS CLASSIFIED THIS WAY?" panel cites the Lobbying Act and an explicit anti-over-reporting rationale ("domain match alone does not confirm DPOH status").
- Provincial attendees (gov.sk.ca, investalberta.ca, invest-quebec.com) were correctly excluded from federal DPOH consideration.
- Confirming one attendee (christian.howes) as a DPOH triggered a **live re-classification cascade**: the meeting flipped Needs input → Auto-drafted, and **both** "CDR Symposium" meetings became ready — correct, since they share that attendee.
- Certifying the month moved it to "✓ 2 certified" with the orthogonal per-meeting "Auto-drafted" badge retained. LRS was not touched (internal state change only).

**Consultant attribution + certification (Maple Leaf).** After linking a Clerk org to the firm tenant (see Finding 1), the consultant view rendered the seeded scenario exactly:

- Three June meetings with auto-suggested clients: NorthVolt (80%), Prairie Hydrogen (80%), and "Coffee with ministry contact" → **No client** (the deliberately below-threshold meeting, correctly unattributed; `ambiguous: 0` confirms the prior floating-point fix holds).
- The NorthVolt suggestion showed full **scored provenance**: +0.5 client-domain match, +0.2 keyword match, +0.1 consultant-of-record = 0.80.
- Confirming the client flipped the attribution Suggested → **Confirmed**, and a per-engagement **"Certify NorthVolt Battery Co. (1)"** batch appeared. The batch count was **1**, not 3 — the unconfirmed Prairie Hydrogen and the No-client meeting were excluded ("2 awaiting client confirmation"). This is the anti-over-reporting guard proven live.
- Certifying produced "✓ 1 certified · 2 awaiting client confirmation."

## Verified by code + tests (not driven live)

**Routed client-RO certification.** The route action mints a single-use 256-bit token (hashed at rest, 14-day TTL) over uncertified lobbying drafts and is role-gated. The public `/certify/[token]` page is token-authorized (no Clerk), white-label aware (tenant → agency → platform fallback), renders the batch read-only with DPOHs/subjects/provenance, and offers an attestation form. `findRoutedBatchByToken` enforces single-use by filtering `certifiedAt: null` + unexpired, so a used or expired token returns the graceful "no longer valid" state. Covered by 16 unit tests (7 certify-routed, 9 route-for-certification), all passing.

## Findings

**1 — No organization switcher on `/filings` or `/agency` (fixed this session).** The `/agency` page instructs users to "Open via org switcher → /filings," but no switcher existed outside `/dashboard`, and there was no user/sign-out control anywhere. For the agency motion this is effectively a launch blocker — a consultant could not reach a managed tenant's filings from inside the app. **Fix applied:** added a shared `HeaderActions` component (Clerk `OrganizationSwitcher` + `UserButton`) to the `/filings` and `/agency` headers. Verified live: the switcher now renders and org-switching works.

**2 — "Route for certification" form shown on the agency's own-filing tenant (fixed this session).** The form rendered whenever `actorKind === "agency"`, including on the firm's own-filing tenant where the `/agency` page says "certify in-app (no routing)," and it showed to a consultant who can't route. **Severity was cosmetic/UI, not a security hole** — the server action correctly rejected the attempt ("Routing for certification requires agency admin or staff membership for this client"), so defense-in-depth held. **Fix applied:** the render gate is now `actorKind === "agency" && !isAgencyOwnTenant && agencyRole ∈ {admin, staff}`, mirroring the server-side authorization. Verified live: the form no longer appears on the Maple Leaf own-filing tenant for the consultant.

**3 — Routing query does not filter on confirmed attribution.** `routeBatchForCertification` selects all uncertified `lobbying` drafts for the month, so it would route unconfirmed / "No client" consultant meetings. The certify-batch path excludes unconfirmed attributions (anti-over-reporting), but the route path does not appear to. Worth confirming this is intended for managed-client routing vs. consultant filings.

**4 — Verify Lobbying Act citation.** The classifier labels "oral, arranged-in-advance communication (scheduled calendar event)" with `[Lobbying Act s. 5(3.1)]`. CLAUDE.md describes the s. 5(1) test. Confirm the cited subsection is the intended provision.

**5 — Seed bug found and fixed (blocker).** `qa:seed` assigned the same `clerkUserId` to two `AgencyMember` rows in one agency, violating the new unique `(agencyId, clerkUserId)` constraint (P2002) — it would fail on any fresh DB. **Fix applied:** the seed now derives distinct IDs via `SEED_FIRM_ADMIN_CLERK_USER_ID` / `SEED_CONSULTANT_CLERK_USER_ID` (with deterministic placeholders), binding the real login to the consultant by default.

**6 — QA onboarding friction.** Reaching agency tenants in-app requires creating Clerk org(s) and re-seeding with `QA_FIRM_ORG_ID` / `QA_CLIENT_ORG_ID`. This is documented but easy to miss; consider noting "create the org first" prominently or having the seed surface the next step.

## Positive confirmations against non-negotiables

- **#1 (CEO certification):** certification is always a deliberate click; nothing auto-submits; LRS untouched by in-app certify.
- **#4 (explainable):** every classification and pre-filled field carried provenance and Lobbying Act citations in the UI.
- **#5 (anti-over-reporting):** unconfirmed attributions excluded from batches; below-threshold meeting left unattributed; domain match alone did not confirm DPOH.
- **#7 (white-label / two-motion):** the public certify page renders branding through the tenant → agency → platform variable chain.
- **Role enforcement:** server-side authorization rejected an out-of-role routing attempt.

## Code changes made this session (uncommitted — review before commit)

- `src/components/HeaderActions.tsx` (new) — org switcher + user button.
- `src/app/filings/page.tsx`, `src/app/agency/page.tsx` — render `HeaderActions` in the header.
- `src/app/filings/page.tsx` — tightened the route-for-certification render gate (Finding 2).
- `scripts/seed-qa-pilot.ts` — distinct admin/consultant clerk IDs (Finding 5).
- `pnpm-workspace.yaml`, `package.json` — `nodeLinker: hoisted` + build-script approvals (environment setup; see below).

**Recommend:** run `pnpm typecheck && pnpm lint` to confirm the header edits, then commit.

## Environment notes (setup done this session)

- Migrated the runtime to **Node 22 → 24 LTS** (Node 25 was non-LTS and broke the lint toolchain).
- pnpm v11 required `nodeLinker: hoisted` in `pnpm-workspace.yaml` (the `@rushstack/eslint-patch` used by `eslint-config-next` can't run under pnpm's symlinked layout) and `allowBuilds` approvals for prisma/esbuild/sharp.
- Neon free-tier compute had cold-started; the first migration attempt timed out and succeeded on retry.

## Suggested next steps

1. Review Finding 3 (routing doesn't filter on confirmed attribution) before the pilots route real client batches. (Finding 2 fixed this session.)
2. Confirm Finding 4 (legal citation).
3. Commit the org-switcher and seed fixes.
4. Optionally complete the live routed-cert walkthrough by re-seeding the tester as agency admin and creating a NorthVolt Clerk org.
