# Detection Pipeline — Architecture Note

**Scope:** federal (OCL) v1. Provincial/municipal pipelines will reuse stages 1–3 with per-jurisdiction rule layers.
**Design goal:** zero-touch detection of reportable meetings, with strong guardrails against over-reporting. Every classification is explainable and user-overridable.

---

## 1. Stages

```
┌──────────────┐  ┌──────────────────┐  ┌────────────────────┐  ┌───────────────┐  ┌──────────────────────┐  ┌──────────────┐  ┌────────────────┐
│ 1. Ingest    │→ │ 2. Gov-domain    │→ │ 3. Identity +      │→ │ 4. DPOH       │→ │ 5. Lobbying          │→ │ 6. Hours     │→ │ 7. User review │
│    calendars │  │    detection     │  │    role resolution │  │    determin.  │  │    classification    │  │    accounting│  │    + queue     │
└──────────────┘  └──────────────────┘  └────────────────────┘  └───────────────┘  └──────────────────────┘  └──────────────┘  └────────────────┘
```

## 2. Stage-by-stage

### Stage 1 — Calendar ingestion
- **Providers (v1):** Google Workspace, Microsoft 365.
- **Providers (v1.5):** Exchange (on-prem and hosted), iCloud, CalDAV, Zoom (for meetings not mirrored to calendar).
- **Fields collected:** title, attendees (name + email), organizer, start/end, location, video link, recurrence metadata, organizer tenant, visibility. **Description/body is opt-in per calendar** and default-off to minimize PII exposure.
- **Cadence:** webhook subscription where available (Google push, M365 Graph subscription); poll every 15 min as fallback.
- **Data residency:** everything stored in Canadian regions. Raw calendar events live no longer than 90 days once processed; only derived records (classified meetings) are retained indefinitely.

### Stage 2 — Government-domain detection
- **Primary match:** email domain against a curated registry of Canadian government domains. Examples: `*.gc.ca`, `*.canada.ca`, `parl.gc.ca`, `sen.parl.gc.ca`, `ec.gc.ca`, `nrcan-rncan.gc.ca`, `ised-isde.canada.ca`, `tbs-sct.gc.ca`, `fin.gc.ca`, `cra-arc.gc.ca`, and ~200 others mapped to institutions.
- **Registry is proprietary.** Auto-curated daily from:
  1. `canada.ca` institution directory
  2. Government Electronic Directory Services (GEDS) export
  3. GCWCC / TBS-published domain lists
  4. Manual curation for ministers' office, Crown corps, and judicial domains
- **Output per attendee:** `{ jurisdiction: 'federal'|'provincial'|'municipal', institution_id, confidence, source }`.

#### `canada.ca` catch-all rule (non-negotiable)

The registry contains a special entry `"Government of Canada (unresolved)"` (`GOC`, `isDpohSource: false`) that maps the shared `canada.ca` domain. This entry exists so that any federal employee whose email has migrated to `@canada.ca` (rather than a department-specific `@dept.gc.ca` domain) is still recognised as a federal contact.

**A `canada.ca` match emits a `needs-resolution` signal at LOW confidence. It MUST NOT be used alone as a basis for:**
- attributing a meeting to a specific institution,
- determining DPOH status, or
- classifying a meeting as lobbying.

**Resolution requirement:** the meeting cannot progress to Stage 3 (identity/role resolution) until at least ONE secondary signal confirms the institution:

1. The calendar organizer's email domain resolves to a specific institution in the registry, OR
2. The attendee's name matches a GEDS or Parliament directory entry (Stage 3 sources), OR
3. The meeting title or body (when body opt-in is enabled) contains an explicit institution name that resolves to a registry entry.

Without a confirmed secondary signal, the meeting remains in `needs-resolution` and surfaces in the inbox as **"Government contact — institution unknown."** It is excluded from the MCR queue and does not contribute to the hours-threshold clock until resolved.

- **Fallback signals** (when email is e.g. `@gmail.com` but calendar was accepted from a gc.ca):
  - Check calendar metadata for the responding domain
  - Parse organizer's domain
  - Name match against known-official directory with high similarity
- **Explicit non-matches:** we never treat a domain as government based on heuristics alone — only the curated registry. Reduces false positives.

### Stage 3 — Identity & role resolution
- Given `(name, email)`, resolve to a person record with role and institution.
- **Sources, in priority order:**
  1. Tenant's own past resolutions (cached, trusted)
  2. GEDS (most of the federal public service)
  3. Parliament directory (MPs, senators, parliamentary secretaries)
  4. Ministerial exempt-staff appointments (published by PMO/OIC)
  5. LinkedIn / public web as tie-breaker (low weight)
- **Output:** `{ person_id, resolved: bool, role_title, institution, seniority_tier, source, confidence }`.
- **Unresolved attendees** surface in the inbox as `Needs your input` — never silently dropped.

### Stage 4 — DPOH determination
A DPOH is defined by the Lobbying Act and regulations, not by title alone. The registry must track the full list:
- Ministers, Ministers of State, Parliamentary Secretaries
- All MPs and Senators
- Ministerial exempt staff (chiefs of staff, senior policy advisors, press secretaries, etc.)
- Deputy Ministers, Associate DMs, Assistant DMs
- Designated positions in named institutions (e.g., heads of specified Crown corps)
- **Output:** `{ is_dpoh: bool, basis: 'role'|'position-designation'|'office-designation', rule_ref }`.
- **Rule_ref** points to the specific regulation clause — audit-trail material for outside counsel.

**Non-DPOH public office holders still matter** for the registration threshold (communication with any POH on in-scope subjects counts toward the 8-hour rule) but not for Monthly Communication Reports. The pipeline distinguishes these two paths explicitly.

### Stage 5 — Lobbying classification
Not every meeting with a DPOH is reportable lobbying. The classifier evaluates:
1. **Oral and arranged** — was this a scheduled interactive communication? Exclusions: open public consultations, webinars, one-way communications, ad-hoc questions during public events.
2. **Subject matter in-scope** — does the discussion fall within the Act's definition of lobbying (legislative proposals, regulations, policies, programs, grants, contracts)? Routine grant-program Q&A is exempt under s. 4(2)(c).
3. **Initiator** — communications initiated by the public office holder on the POH's own request are exempt from MCR reporting (but still counted toward threshold awareness).
4. **Emergency / response to Parliamentary committee subpoena** — exempt.

**Classifier output:**
```
{
  verdict: 'lobbying' | 'not-lobbying' | 'needs-info',
  confidence: 0..1,
  reasons: [{ ok, text, cite? }],
  suggested_subjects: [subject_id],
}
```

Low-confidence verdicts always route to `Needs review`. We never auto-submit; at most we auto-exclude obvious non-lobbying events (open webinars, procurement info sessions).

### Stage 6 — Hours accounting
Two separate tallies, both displayed in the UI:

**a) Registration-threshold clock (the 8-hour rolling window)**
- Scope: all communication attempts and preparation with any public office holder (not just DPOHs) on in-scope subjects.
- Sum: meeting duration + user-confirmed preparation time (per OCL's Jan 2026 bulletin) + grassroots outreach time.
- Attribution: across **all employees** in the tenant organization.
- Window: any rolling 4-week period — we compute the max across recent windows, not just the trailing 28 days.
- Alerts: 75% (soft), 90% (urgent), 100% (must register within 2 months).

**b) MCR-reportable hours**
- Scope: confirmed-lobbying meetings with DPOHs only.
- Used for: filings, trend reporting, benchmarks.
- Never mixed with the threshold clock.

### Stage 7 — Pre-fill engine
The classifier's verdict is only step one. For any meeting classified as lobbying, the pre-fill engine drafts the full MCR without asking the user.

**Inputs (priors, in priority order):**
1. **Org profile** (set once at onboarding) — industry, default subjects, active registration state, named employee lobbyists, typical institutions, preferred filing voice.
2. **Past filings corpus** — the tenant's last 20–50 MCRs. The richest signal; captures subject-matter habits, phrasing, institution mapping, and edge cases the customer has decided in the past.
3. **Meeting signals** — title, attendee roles, institution of DPOH, duration, recurrence pattern.
4. **Public OCL registry** — neighbors' filings at similar orgs (used as fallback when the tenant has few past filings).

**Outputs (every field pre-populated with provenance):**
- Institution (inferred from DPOH → institution registry)
- Subject matters (intersection of meeting signals, org profile, and registration)
- Description text (drafted in the tenant's filing voice — learned from past filings)
- Named employee (attendee + org profile)

**Provenance-per-field.** Every pre-filled value carries a source tag (`geds`, `exempt-staff-registry`, `past-filings`, `org-profile`, `calendar`, `llm-draft`) that the UI surfaces as a small coloured dot. The user can always see *why* a field has its value.

#### OCL subject-matter lag and multi-year issue persistence

OCL's `Communication_SubjectMattersExport.csv` lags `Communication_PrimaryExport.csv` by ~18 months. For recent comms (trailing 1.5 years), OCL subjects are not available in the open data.

**Implication for classifier + pre-fill:** a registrant's historical subjects (2019–mid-2024) are a strong prior for their current subject mix, because most government-affairs issues unfold over multi-year policy arcs — a registrant lobbying on carbon pricing in 2023 is overwhelmingly still lobbying on carbon pricing in 2026.

**Design rule:** when OCL subjects are unavailable for a recent comm, pre-fill the MCR with the registrant's most frequent subjects from their 2019–mid-2024 history, tagged with provenance `"inferred from prior filings — please review."` Never assert the inference as fact; the CEO certification step must see the inference and can edit before signing. The user's own past MCRs (drafted inside Auto Lobby) always take precedence over OCL-derived inferences.

**Not a rule to mechanically apply:** sometimes subjects do change — new programs launch, regulations shift, companies pivot. Treat historical subjects as a soft signal, not a deterministic mapping.

### Stage 8 — Monthly certification gate
This is the sole human-in-the-loop step. Once per month (by the 15th), the CEO/senior officer reviews the pre-drafted batch and certifies.

- **Default action:** "Certify & submit all" — single click opens a supervised GCKey session, automation logs in, and the CEO attests to the batch inside LRS.
- **Outliers surface at the top** of the batch view — low-confidence classifications, unresolved attendees, newly-appearing subjects not on the registration — with one-tap resolution.
- **Everything else is invisible** unless the user asks. The Activity Log shows what the agent did; it is not a to-do list.
- **Target friction:** ≤ 5 minutes per month of CEO time for a typical Deep Sky-sized registrant.
- **User edits inform the next batch.** Every correction is captured as a per-tenant classifier signal (never cross-tenant). The agent gets better at each org specifically over time.

---

## 3. Anti-over-reporting guardrails (non-negotiable)

1. **Default to exclusion on low-confidence signals** — unresolved attendees, public consultations, and procurement Q&A are flagged non-reportable by default.
2. **Distinguish domain-match from DPOH status.** An `@ec.gc.ca` meeting is not automatically lobbying. The product surfaces DPOH status as a separate badge.
3. **Explainability everywhere.** Every classification ships with the reasons that drove it and citations to the Act. If a user disagrees, they click once to override; the reasons feed a tuning loop.
4. **Internal-only audit logging for non-reportable gov meetings.** We keep the record for the customer's own audit trail and dispute resilience, but these events never touch the MCR queue or the threshold clock by default.
5. **Per-tenant calibration.** Each organization has its own history of edge cases (e.g., "our procurement discussions are always non-lobbying"). The classifier learns from confirmations and overrides within-tenant only.
6. **"Would this cross the threshold?" preview.** Before the user confirms a marginal meeting as lobbying, the UI shows the hours-clock impact so they can weigh accurately.
7. **Cap on reasonable preparation time.** Absent specific user input, prep time is not invented. We count only: explicit calendar-blocked prep, logged prep entries, or a conservative 25% multiplier the user must opt into.

---

## 4. Data-model sketch

```
Organization ──1..n── Employee
Organization ──1..n── CalendarConnection ──1..n── RawCalendarEvent
RawCalendarEvent ──1..1── DetectedMeeting
DetectedMeeting ──1..n── MeetingAttendee ─── PublicOfficial (nullable)
DetectedMeeting ──1..n── ClassificationReason
DetectedMeeting ──0..1── DraftMCR
DetectedMeeting ──1..n── HoursLedgerEntry (threshold-clock and reportable tallies separate)

PublicOfficial
  ├── person_id
  ├── current_role
  ├── institution_id
  ├── is_dpoh (bool)
  ├── dpoh_basis
  ├── resolved_from (source enum)
  └── effective_date, end_date (handles role changes)

InstitutionRegistry (proprietary)
  ├── institution_id, name
  ├── jurisdiction
  ├── domains[]
  └── dpoh_designations[]
```

---

## 5. Things we explicitly don't do

- **Don't submit without CEO certification.** Ever.
- **Don't hold GCKey credentials.** Ever.
- **Don't train cross-tenant on private calendars.** Classifier is per-tenant.
- **Don't auto-classify as lobbying** without DPOH resolution and meeting structure evidence. Low-confidence → `Needs review`.
- **Don't export calendar bodies** to third parties (including AI providers) unless the tenant enables it explicitly for classification boost.
