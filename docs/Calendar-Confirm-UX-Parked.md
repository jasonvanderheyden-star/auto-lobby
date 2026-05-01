# Future feature — In-calendar confirmation UX (parked)

Resume after Phase 3 ships (Monthly Certification UI live with ≥1 design partner using it weekly). The MVP path is one-click monthly batch certification. This idea is additive, not replacement.

## The idea

Surface Auto Lobby's classification in the place the meeting actually lives — the user's calendar — so the person who attended the meeting can confirm or correct the auto-classification with a single click. Two outcomes:

- **For the user:** zero new app to open. They see "Auto Lobby flagged this as a government meeting" inside their calendar, click confirm or correct, done.
- **For the classifier:** every confirmation/correction becomes a high-confidence training signal. The person who took the meeting knows whether it was lobbying. Their toggle is more reliable than any algorithmic guess.

## Why it matters strategically

Auto Lobby's current product spec is "≤ 5 minutes of CEO time per month" — single batched action. That principle is correct for the certifier (the senior officer attesting under oath), but it leaves the **rank-and-file lobbyist** out of the loop. Today, the person actually in the meeting has no role in the system. Adding a calendar-side confirm UX gives them participation without burden — no MCR drafting, no certification responsibility, just a per-meeting yes/no that can take 3 seconds.

This creates a **two-tier UX** that aligns with the actual roles in the Lobbying Act:

| Persona | Today's UX | Proposed UX |
|---------|-----------|-------------|
| Senior officer (certifier) | Once-monthly batch certification | Unchanged — still one click per month |
| Named lobbyist (attendee) | Invisible | Per-meeting confirm in calendar |

By the time the senior officer sees the monthly batch, the drafts have already been validated by the people in the rooms. False positives drop. Confidence rises. The certification ritual becomes "I'm trusting my team's already-confirmed inputs," not "I'm guessing whether the algorithm got it right."

## Where the UI can actually live

The literal "embedded checkbox inside the event card" is not technically possible — Google Calendar and Outlook do not expose UI extension points inside the event itself. What is supported:

- **Google Workspace Add-on (sidebar).** When a user clicks an event in Google Calendar, our add-on shows a panel on the right with the flag + toggle + reasoning. Built in Apps Script or hosted Node, distributed via the Google Workspace Marketplace. Durable, supported. Limitation: web Google Calendar only.
- **Outlook Add-in (task pane).** Same pattern for Microsoft 365. Works in Outlook web + desktop.
- **Browser extension.** Inject UI into calendar.google.com / outlook.live.com DOM. Most visual flexibility — can appear *inside* the event card. Fragile (Google ships UI changes), browser-specific, no mobile, requires manual install.
- **Pre-meeting notification (Slack DM or email).** "Heads up — your 10:30 with X looks government. Confirm/correct →" with a one-click link. Works for every calendar app without integration. Low integration cost. Lowest in-the-moment fidelity.

## What not to do

**Do not write the flag into the event description field.** That requires Google `calendar.events` write scope and crosses the "we never modify your calendar" line — a trust principle cited in the OAuth consent text users actually read. Trading that away for a faux-checkbox isn't worth the trust cost.

## Tradeoff matrix

| Option | Build cost | Distribution | Fidelity | Mobile | Trust posture |
|--------|-----------|--------------|----------|--------|---------------|
| Google Workspace Add-on | Medium | Marketplace listing — discovery channel | Good | No | Read-only, supported |
| Outlook Add-in | Medium | AppSource listing | Good | Partial | Read-only, supported |
| Browser extension | Low | Chrome/Edge stores | Best | No | Read-only, supported |
| Pre-meeting Slack DM | Low | Already in workflow | OK | Yes | Read-only |

## Triggers for revisiting

- Phase 3 (Monthly Certification UI) is live with ≥1 design partner certifying real batches monthly
- Classifier false-positive rate is high enough that the certifier has to manually correct >10% of drafts each month — at that point, in-context correction by attendees pays for itself
- Design partner asks for it ("can my team see what's been flagged before I review?")
- Workspace Marketplace listing emerges as a meaningful channel for new sign-ups

## Open questions

- **Sequencing:** ship the Slack DM version first (lowest cost, works everywhere) and use the data to inform whether the calendar-native add-on is worth the build?
- **Confirmation gravity:** does an attendee's "yes, this is government" raise classifier confidence enough to skip CEO certification on uncontroversial meetings? (Probably not — the Act requires CEO attestation regardless. But it could shorten the cert review.)
- **Multi-attendee meetings:** if two attendees from the same tenant disagree on the flag, who wins? Tiebreak rule?
- **Privacy boundary:** does the sidebar render attendee names from our DB, or just trust the calendar's view? (Probably the latter — minimize data echo.)
- **Distribution:** Workspace Marketplace listings need verified-publisher status from Google. Lead time?

## Context for whoever resumes

- Idea logged 2026-04-30 by Jason (jason@deepskyclimate.com), founder of Deep Sky Climate, end of Phase 1 build day.
- Surfaced as "embed a checkbox inside the calendar event itself." Reframed: literal embed isn't possible, but sidebar add-ons + browser extensions + Slack DMs cover the spirit.
- See `prototypes/Calendar-Confirm-UX.html` for the visual mockups across the four delivery options.
- Strategic insight from the conversation: this isn't a CEO feature, it's an attendee feature. Pairs with — doesn't replace — the once-a-month CEO certification model.
