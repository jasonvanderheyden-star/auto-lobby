/**
 * src/server/engagements/suggest-engagement.ts
 *
 * Meeting → client attribution for agency-own tenants (consultant lobbying).
 *
 * Consultant calendars live in the firm's own tenant (Tenant.isAgencyOwnTenant),
 * so a detected lobbying meeting must be attributed to one of the firm's client
 * undertakings (Engagement) before it can be filed. This module scores each
 * active engagement against explainable signals and writes an auto-suggestion
 * with full provenance (non-negotiable #4).
 *
 * Scoring (max 1.0):
 *   +0.5  a non-government external attendee's email domain is in clientDomains
 *   +0.2  meeting title contains a subjectKeyword (case-insensitive substring)
 *   +0.2  meeting.institutionId is in keyInstitutions
 *   +0.1  calendar owner (employeeEmail) is the engagement's consultant of record
 *
 * A suggestion is written only when the top score >= 0.5 AND it beats the
 * runner-up by >= 0.2. Anti-over-reporting (non-negotiable #5): auto-suggested
 * attributions NEVER flow into a filing batch — only "confirmed"/"manual" do
 * (enforced in consultant-batches.ts and prepare-submission.ts).
 */

import { db } from "@/lib/db";
import { appendAuditEvent } from "@/server/audit-log/append";

export const SUGGESTION_MIN_SCORE = 0.5;
export const SUGGESTION_MIN_MARGIN = 0.2;

const WEIGHT_CLIENT_DOMAIN = 0.5;
const WEIGHT_SUBJECT_KEYWORD = 0.2;
const WEIGHT_KEY_INSTITUTION = 0.2;
const WEIGHT_CONSULTANT_CALENDAR = 0.1;

const GOV_EMAIL_RE = /\.(gc|parl)\.ca$/i;

export interface EngagementSignal {
  signal:
    | "client-domain"
    | "subject-keyword"
    | "key-institution"
    | "consultant-calendar";
  weight: number;
  /** Human-readable explanation. Never contains attendee names or emails. */
  detail: string;
}

export interface EngagementScore {
  engagementId: string;
  clientName: string;
  score: number;
  signals: EngagementSignal[];
}

export type SuggestionOutcome =
  | "suggested"
  | "cleared" // stale auto-suggestion no longer meets threshold
  | "below-threshold"
  | "ambiguous"
  | "already-attributed"
  | "not-agency-own-tenant"
  | "no-active-engagements";

export interface SuggestEngagementResult {
  meetingId: string;
  outcome: SuggestionOutcome;
  suggestion: EngagementScore | null;
  scores: EngagementScore[];
}

// ─── Internal shapes (typed against the schema, not generated client) ──────

interface ActiveEngagement {
  id: string;
  clientName: string;
  clientDomains: string[];
  subjectKeywords: string[];
  keyInstitutions: string[];
  consultantMember: { email: string } | null;
}

interface MeetingForScoring {
  id: string;
  tenantId: string;
  title: string;
  institutionId: string | null;
  employeeEmail: string;
  engagementId: string | null;
  engagementSource: string | null;
  attendees: Array<{ email: string; isInternal: boolean }>;
}

const MEETING_SELECT = {
  id: true,
  tenantId: true,
  title: true,
  institutionId: true,
  employeeEmail: true,
  engagementId: true,
  engagementSource: true,
  attendees: { select: { email: true, isInternal: true } },
} as const;

async function loadActiveEngagements(
  agencyId: string,
): Promise<ActiveEngagement[]> {
  return db.engagement.findMany({
    where: { agencyId, status: "active" },
    select: {
      id: true,
      clientName: true,
      clientDomains: true,
      subjectKeywords: true,
      keyInstitutions: true,
      consultantMember: { select: { email: true } },
    },
  });
}

/** Email domains of external, non-government attendees (lowercased). */
function externalNonGovDomains(meeting: MeetingForScoring): Set<string> {
  const domains = new Set<string>();
  for (const a of meeting.attendees) {
    if (a.isInternal || !a.email) continue;
    if (GOV_EMAIL_RE.test(a.email)) continue;
    const at = a.email.lastIndexOf("@");
    if (at === -1) continue;
    domains.add(a.email.slice(at + 1).toLowerCase());
  }
  return domains;
}

function scoreEngagement(
  engagement: ActiveEngagement,
  meeting: MeetingForScoring,
  externalDomains: Set<string>,
): EngagementScore {
  const signals: EngagementSignal[] = [];

  const domainHits = engagement.clientDomains
    .map((d) => d.toLowerCase())
    .filter((d) => externalDomains.has(d));
  if (domainHits.length > 0) {
    signals.push({
      signal: "client-domain",
      weight: WEIGHT_CLIENT_DOMAIN,
      detail: `External attendee domain ${domainHits.join(", ")} is registered for this client`,
    });
  }

  const titleLower = meeting.title.toLowerCase();
  const keywordHits = engagement.subjectKeywords.filter(
    (kw) => kw.trim().length > 0 && titleLower.includes(kw.toLowerCase()),
  );
  if (keywordHits.length > 0) {
    signals.push({
      signal: "subject-keyword",
      weight: WEIGHT_SUBJECT_KEYWORD,
      detail: `Meeting title matches keyword${keywordHits.length === 1 ? "" : "s"}: ${keywordHits.join(", ")}`,
    });
  }

  if (
    meeting.institutionId &&
    engagement.keyInstitutions.includes(meeting.institutionId)
  ) {
    signals.push({
      signal: "key-institution",
      weight: WEIGHT_KEY_INSTITUTION,
      detail: "Meeting institution is a key institution for this undertaking",
    });
  }

  if (
    engagement.consultantMember?.email &&
    meeting.employeeEmail.toLowerCase() ===
      engagement.consultantMember.email.toLowerCase()
  ) {
    signals.push({
      signal: "consultant-calendar",
      weight: WEIGHT_CONSULTANT_CALENDAR,
      detail: "Calendar owner is the consultant of record for this undertaking",
    });
  }

  return {
    engagementId: engagement.id,
    clientName: engagement.clientName,
    score: signals.reduce((sum, s) => sum + s.weight, 0),
    signals,
  };
}

/**
 * Score + persist for one already-loaded meeting against pre-loaded
 * engagements. Used by both entry points so backfills load engagements once.
 */
async function evaluateAndPersist(
  meeting: MeetingForScoring,
  engagements: ActiveEngagement[],
): Promise<SuggestEngagementResult> {
  // A confirmed/manual attribution is a human decision — never overwrite.
  if (
    meeting.engagementSource === "confirmed" ||
    meeting.engagementSource === "manual"
  ) {
    return {
      meetingId: meeting.id,
      outcome: "already-attributed",
      suggestion: null,
      scores: [],
    };
  }

  if (engagements.length === 0) {
    return {
      meetingId: meeting.id,
      outcome: "no-active-engagements",
      suggestion: null,
      scores: [],
    };
  }

  const externalDomains = externalNonGovDomains(meeting);
  const scores = engagements
    .map((e) => scoreEngagement(e, meeting, externalDomains))
    .sort((a, b) => b.score - a.score);

  const top = scores[0];
  const runnerUp = scores[1];
  if (!top) {
    return {
      meetingId: meeting.id,
      outcome: "no-active-engagements",
      suggestion: null,
      scores,
    };
  }
  const runnerUpScore = runnerUp?.score ?? 0;
  // Weights are decimal floats; sums like 0.5 + 0.2 accumulate FP error
  // (0.7 - 0.5 === 0.19999999999999998), so compare with a tiny epsilon to
  // keep the documented >= boundaries exact.
  const FP_EPSILON = 1e-9;
  const meetsThreshold = top.score >= SUGGESTION_MIN_SCORE - FP_EPSILON;
  const unambiguous =
    top.score - runnerUpScore >= SUGGESTION_MIN_MARGIN - FP_EPSILON;

  if (!meetsThreshold || !unambiguous) {
    // If a previous run auto-suggested an engagement that no longer clears the
    // bar (engagement edited, attendees re-resolved), clear the stale
    // suggestion so the UI never shows an unjustified attribution. The clear
    // itself is audited — every state change is explained.
    if (meeting.engagementSource === "auto-suggested") {
      await db.detectedMeeting.updateMany({
        where: { id: meeting.id, tenantId: meeting.tenantId },
        data: {
          engagementId: null,
          engagementSource: null,
          engagementConfidence: null,
        },
      });
      await appendAuditEvent({
        tenantId: meeting.tenantId,
        actor: "system",
        actorRole: "system",
        action: "engagement-suggested",
        subject: meeting.id,
        payload: {
          outcome: "cleared",
          reason: meetsThreshold ? "ambiguous" : "below-threshold",
          previousEngagementId: meeting.engagementId,
          topScore: top.score,
          runnerUpScore,
          minScore: SUGGESTION_MIN_SCORE,
          minMargin: SUGGESTION_MIN_MARGIN,
        },
      });
      return { meetingId: meeting.id, outcome: "cleared", suggestion: null, scores };
    }
    return {
      meetingId: meeting.id,
      outcome: meetsThreshold ? "ambiguous" : "below-threshold",
      suggestion: null,
      scores,
    };
  }

  await db.detectedMeeting.updateMany({
    where: { id: meeting.id, tenantId: meeting.tenantId },
    data: {
      engagementId: top.engagementId,
      engagementSource: "auto-suggested",
      engagementConfidence: top.score,
    },
  });

  // Explainability (non-negotiable #4): full per-signal breakdown.
  await appendAuditEvent({
    tenantId: meeting.tenantId,
    actor: "system",
    actorRole: "system",
    action: "engagement-suggested",
    subject: meeting.id,
    payload: {
      outcome: "suggested",
      engagementId: top.engagementId,
      clientName: top.clientName,
      score: top.score,
      signals: top.signals.map((s) => ({ ...s })),
      runnerUp: runnerUp
        ? { engagementId: runnerUp.engagementId, score: runnerUp.score }
        : null,
      minScore: SUGGESTION_MIN_SCORE,
      minMargin: SUGGESTION_MIN_MARGIN,
    },
  });

  return { meetingId: meeting.id, outcome: "suggested", suggestion: top, scores };
}

/**
 * Suggest a client engagement for one DetectedMeeting.
 * No-op (outcome "not-agency-own-tenant") unless the meeting's tenant has an
 * agencyId AND isAgencyOwnTenant — in-house tenants never pay for this.
 */
export async function suggestEngagement(
  meetingId: string,
): Promise<SuggestEngagementResult> {
  const meeting = await db.detectedMeeting.findUniqueOrThrow({
    where: { id: meetingId },
    select: {
      ...MEETING_SELECT,
      tenant: { select: { agencyId: true, isAgencyOwnTenant: true } },
    },
  });

  if (!meeting.tenant.agencyId || !meeting.tenant.isAgencyOwnTenant) {
    return {
      meetingId,
      outcome: "not-agency-own-tenant",
      suggestion: null,
      scores: [],
    };
  }

  const engagements = await loadActiveEngagements(meeting.tenant.agencyId);
  return evaluateAndPersist(meeting, engagements);
}

export interface SuggestForTenantSummary {
  evaluated: number;
  suggested: number;
  cleared: number;
  belowThreshold: number;
  ambiguous: number;
}

/**
 * Backfill: re-run suggestion across every lobbying / needs-info meeting of an
 * agency-own tenant that does not yet have a confirmed/manual attribution.
 * Loads the engagement set once for the whole run.
 */
export async function suggestEngagementsForTenant(
  tenantId: string,
): Promise<SuggestForTenantSummary> {
  const summary: SuggestForTenantSummary = {
    evaluated: 0,
    suggested: 0,
    cleared: 0,
    belowThreshold: 0,
    ambiguous: 0,
  };

  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { agencyId: true, isAgencyOwnTenant: true },
  });
  if (!tenant.agencyId || !tenant.isAgencyOwnTenant) return summary;

  const engagements = await loadActiveEngagements(tenant.agencyId);

  const meetings = await db.detectedMeeting.findMany({
    where: {
      tenantId,
      classification: { in: ["lobbying", "needs-info"] },
      OR: [{ engagementSource: null }, { engagementSource: "auto-suggested" }],
    },
    select: MEETING_SELECT,
  });

  for (const meeting of meetings) {
    const result = await evaluateAndPersist(meeting, engagements);
    summary.evaluated++;
    if (result.outcome === "suggested") summary.suggested++;
    else if (result.outcome === "cleared") summary.cleared++;
    else if (result.outcome === "below-threshold") summary.belowThreshold++;
    else if (result.outcome === "ambiguous") summary.ambiguous++;
  }

  return summary;
}
