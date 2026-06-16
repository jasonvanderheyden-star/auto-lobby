# Auto Lobby — Project Memory

Portable snapshot of the working memory that previously lived only in the
Cowork assistant's per-account memory store. Committed to the repo so it
survives an account move and is readable by any future session. Point-in-time
notes — verify against current code before relying on file/line specifics.

## Direction (as of 2026-06-10) — agency motion unparked

Jason has a couple of lobbying/law firms willing to pilot Auto Lobby. The
agency GTM motion (`docs/Agency-Motion-Parked.md`) is effectively **unparked** —
build toward production-ready, not minimal QA.

Confirmed decisions:

- **Two top-level use cases.** (1) In-house tenant with multiple calendar
  contributors but a single Responsible Officer certifier. (2) Firm/agency,
  which splits into: consultant filings (the consultant certifies their own
  MCRs per client undertaking), managed in-house clients (draft routed to the
  client's senior officer for certification), and the firm's own in-house
  filing.
- **Consultant meeting→client attribution** is auto-suggested by the classifier
  with provenance, then the consultant confirms — not manual-only. Auto-suggested
  ("guessed") attributions never enter a filing batch until confirmed
  (non-negotiable #5).
- **Calendar integrations** must include Microsoft 365 (Graph) in addition to
  Google; other standard calendars desired.
- **QA approach:** code-level tests first, then a live browser walkthrough as
  each persona, with a findings report (see `docs/QA-Walkthrough-2026-06-15.md`).

Why: pilots are committed; production readiness gates revenue. When working in
this project, treat agency features as current scope (not parked), enforce
certifier-role gating, and keep the non-negotiables (CEO certification, no
credential custody) intact in every flow.

## Local dev toolchain (hard-won, 2026-06-15)

- **Node 24 LTS** (via nvm; `nvm alias default 24`). Node 25 is non-LTS and
  breaks `eslint-config-next`'s `@rushstack/eslint-patch`; Node 22 is already
  Maintenance LTS. Build/deploy target = Node 24.
- **pnpm v11** via Corepack (`corepack enable pnpm`). Requires
  `pnpm-workspace.yaml` with `nodeLinker: hoisted` (pnpm's symlinked layout
  breaks the rushstack eslint patch → "calling module was not recognized" /
  can't find `@eslint/eslintrc`) **and** an `allowBuilds:` map approving prisma,
  esbuild, sharp, protobufjs, unrs-resolver. These settings live in
  `pnpm-workspace.yaml`, NOT `package.json#pnpm` (ignored in v11) or `.npmrc`
  (ignored in v11). `package-lock.json` removed — `pnpm-lock.yaml` is the lockfile.
- **Prisma migrations** need env from `.env.local`: run
  `npx dotenv-cli -e .env.local -- npx prisma migrate dev`. `DIRECT_URL`
  (non-pooled Neon) is used for migrations. Neon free-tier compute cold-starts
  after idle → first attempt may fail `P1001`; just retry.
- **Verify gate:** `pnpm typecheck && pnpm test && pnpm lint` (tsc, 151 vitest
  tests, eslint). Dev server: `pnpm dev`.
- **Git from a sandbox on the mounted folder** emits `Operation not permitted`
  warnings on `.git` lock/temp files and cannot reach the HTTPS remote (no
  credentials). Run `git push`/`pull` from your own terminal.
- **Do NOT keep the repo in an iCloud-synced folder.** The project previously
  lived under `~/Documents/Claude/Projects/Auto Lobby`; macOS syncs `~/Documents`
  to iCloud Drive by default, which corrupted `node_modules` — iCloud created
  ~70 conflict-copy artifacts (`lib 2/`, `Hook 2.js`, `vite 2`, etc.) and
  displaced real files (e.g. `pure-rand/lib/pure-rand.js` went missing), so Node
  threw `MODULE_NOT_FOUND` and `pnpm install` reported "Already up to date"
  because the package dir + `package.json` still satisfied the lockfile check.
  Diagnosed + fixed 2026-06-16. Fix when it recurs: `rm -rf node_modules &&
  pnpm install` (pause iCloud first so it doesn't race the install). Durable
  fix: keep the working copy in an unsynced path (e.g. `~/dev/auto-lobby`).

## Commit state

Phases 4–6 (LRS submission, audit-log, fuzzy matching, agency
roles/engagements/routing, M365) plus the QA Finding 3 fix (routing excludes
unconfirmed attributions) are committed and pushed to `origin/main`
(`github.com/jasonvanderheyden-star/auto-lobby`).
