import type { AttendeeResolution } from "@/server/dpoh-registry/resolve-attendee";

export type ClassificationVerdict = "lobbying" | "not-lobbying" | "needs-info";

export interface ClassificationReasonRow {
  ok: boolean | null;
  text: string;
  citation: string | null;
  weight: number;
}

export interface ClassificationResult {
  verdict: ClassificationVerdict;
  confidence: number;
  hadDpoh: boolean;
  reasons: ClassificationReasonRow[];
}

export interface MeetingInput {
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

const EXCLUSION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /consultation/i, label: "consultation" },
  { pattern: /town hall/i, label: "town hall" },
  { pattern: /open forum/i, label: "open forum" },
  { pattern: /public engagement/i, label: "public engagement" },
  { pattern: /information session/i, label: "information session" },
  { pattern: /office hours/i, label: "office hours" },
  { pattern: /procurement/i, label: "procurement" },
  { pattern: /\brfp\b/i, label: "RFP" },
  { pattern: /tender/i, label: "tender" },
  { pattern: /request for proposal/i, label: "request for proposal" },
  { pattern: /\bq[\s&]*a\b/i, label: "Q&A" },
];

export function classifyMeeting(
  meeting: MeetingInput,
  resolutions: AttendeeResolution[],
): ClassificationResult {
  const reasons: ClassificationReasonRow[] = [];

  const internal = resolutions.filter((r) => r.isInternal);
  const namedDpohs = resolutions.filter((r) => r.signal === "gov-with-named-dpoh");
  const namedNonDpohs = resolutions.filter((r) => r.signal === "gov-with-named-non-dpoh");
  const unknownGovs = resolutions.filter((r) => r.signal === "gov-attendee-unknown-role");
  const govNotDpoh = resolutions.filter((r) => r.signal === "gov-not-dpoh-source");
  const govUnresolved = resolutions.filter((r) => r.signal === "gov-unresolved");

  // Rule 1: must have an internal attendee
  if (internal.length === 0) {
    reasons.push({
      ok: false,
      text: "No internal employee on this event — not the registrant's meeting to report.",
      citation: "Lobbying Act s. 5(1) — registrant must be a party to the communication",
      weight: 1.0,
    });
    return { verdict: "not-lobbying", confidence: 0.95, hadDpoh: false, reasons };
  }
  reasons.push({
    ok: true,
    text: `${internal.length} internal employee(s) on the meeting.`,
    citation: null,
    weight: 0.5,
  });

  // Rule 2: must have a federal gov attendee
  const govCount =
    namedDpohs.length +
    namedNonDpohs.length +
    unknownGovs.length +
    govNotDpoh.length +
    govUnresolved.length;
  if (govCount === 0) {
    reasons.push({
      ok: false,
      text: "No federal government attendees on this event.",
      citation: "Lobbying Act s. 5(1) — communication must be with a public office holder",
      weight: 1.0,
    });
    return { verdict: "not-lobbying", confidence: 0.95, hadDpoh: false, reasons };
  }

  // Rule 3: oral + arranged in advance (calendar event satisfies this by structure)
  reasons.push({
    ok: true,
    text: "Oral, arranged-in-advance communication (scheduled calendar event).",
    citation: "Lobbying Act s. 5(3.1)",
    weight: 0.5,
  });

  // Rule 4: title-pattern exclusion (anti-over-reporting bias)
  const title = meeting.title ?? "";
  for (const ex of EXCLUSION_PATTERNS) {
    if (ex.pattern.test(title)) {
      reasons.push({
        ok: false,
        text: `Title contains "${ex.label}" pattern — typically public consultation, procurement Q&A, or routine program inquiry. Excluded from auto-reporting.`,
        citation: "CLAUDE.md non-negotiable #5 (anti-over-reporting bias)",
        weight: 1.0,
      });
      return {
        verdict: "not-lobbying",
        confidence: 0.8,
        hadDpoh: namedDpohs.length > 0,
        reasons,
      };
    }
  }

  // Rule 5: verdict by highest-confidence gov attendee signal
  if (namedDpohs.length > 0) {
    const list = namedDpohs
      .map((d) => `${d.resolvedOfficialName} (${d.resolvedOfficialRole}, ${d.institutionAcronym ?? d.institutionName})`)
      .join(", ");
    reasons.push({
      ok: true,
      text: `Named DPOH attendee(s): ${list}.`,
      citation: namedDpohs[0]!.dpohRuleRef ?? "Lobbying Act s. 2(1) DPOH",
      weight: 1.0,
    });
    const matchedByEmail = namedDpohs.some((d) => d.dpohMatchedBy === "email-exact");
    return {
      verdict: "lobbying",
      confidence: matchedByEmail ? 0.85 : 0.75,
      hadDpoh: true,
      reasons,
    };
  }

  if (unknownGovs.length > 0) {
    const list = unknownGovs
      .map((u) => `${u.email ?? "(no email)"} at ${u.institutionAcronym ?? u.institutionName}`)
      .join(", ");
    reasons.push({
      ok: null,
      text: `${unknownGovs.length} federal attendee(s) at DPOH-source institution(s); role unconfirmed: ${list}. Cannot determine designation status without further input.`,
      citation: "Anti-over-reporting: domain match alone does not confirm DPOH status",
      weight: 1.0,
    });
    return { verdict: "needs-info", confidence: 0.5, hadDpoh: false, reasons };
  }

  if (govUnresolved.length > 0) {
    reasons.push({
      ok: null,
      text: `${govUnresolved.length} attendee(s) on canada.ca shared domain — institution cannot be determined.`,
      citation: null,
      weight: 1.0,
    });
    return { verdict: "needs-info", confidence: 0.4, hadDpoh: false, reasons };
  }

  if (namedNonDpohs.length > 0) {
    const list = namedNonDpohs
      .map((n) => `${n.resolvedOfficialName} (${n.institutionAcronym ?? n.institutionName})`)
      .join(", ");
    reasons.push({
      ok: false,
      text: `Federal attendee(s) explicitly marked as non-DPOH by user: ${list}. Not reportable lobbying on the basis of these attendees.`,
      citation: "User-confirmed not-DPOH classification",
      weight: 1.0,
    });
    return { verdict: "not-lobbying", confidence: 0.9, hadDpoh: false, reasons };
  }

  if (govNotDpoh.length > 0) {
    const inst = govNotDpoh[0]!;
    reasons.push({
      ok: false,
      text: `Federal attendee(s) at non-DPOH-source institution(s) (${inst.institutionAcronym ?? inst.institutionName}). Crown corps and arm's-length bodies do not have DPOHs by default.`,
      citation: null,
      weight: 1.0,
    });
    return { verdict: "not-lobbying", confidence: 0.8, hadDpoh: false, reasons };
  }

  return { verdict: "needs-info", confidence: 0.3, hadDpoh: false, reasons };
}
