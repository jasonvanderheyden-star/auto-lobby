/**
 * prepare-submission.ts
 *
 * Queries the DB and builds LrsSubmissionPayload[] for all DraftMcrs that
 * have been certified but not yet submitted for a given tenant.
 */

import { db } from "@/lib/db";
import type { LrsDpoh, LrsSubmissionPayload, LrsSubjectDetail } from "./types";

/**
 * Split a full name into firstName / lastName by splitting on the last space.
 *
 * Examples:
 *   "Jonathan Wilkinson"   → { firstName: "Jonathan",   lastName: "Wilkinson" }
 *   "Marc-André Blanchard" → { firstName: "Marc-André",  lastName: "Blanchard" }
 *   "Chrystia"             → { firstName: "",            lastName: "Chrystia" }
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) {
    return { firstName: "", lastName: trimmed };
  }
  return {
    firstName: trimmed.slice(0, lastSpace),
    lastName: trimmed.slice(lastSpace + 1),
  };
}

/**
 * Format an institution name for the LRS dropdown.
 * LRS shows institutions as "Name (ACRONYM)" when an acronym exists.
 */
function formatInstitutionLabel(name: string, acronym: string | null): string {
  if (acronym) return `${name} (${acronym})`;
  return name;
}

export async function prepareSubmissions(
  tenantId: string,
  /** Optional month filter "YYYY-MM" — only submit MCRs for that calendar month. */
  month?: string,
  /**
   * Optional consultant-undertaking filter. When set, only MCRs whose meeting
   * carries a HUMAN-CONFIRMED attribution ("confirmed" | "manual") to this
   * engagement are submitted, one undertaking's batch at a time, and the
   * payload clientName is the engagement's client (the registrant files on the
   * client's registration). Default behavior for in-house tenants is unchanged.
   */
  engagementId?: string,
): Promise<LrsSubmissionPayload[]> {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, agencyId: true },
  });

  let engagementClientName: string | null = null;
  if (engagementId) {
    if (!tenant.agencyId) {
      throw new Error(
        "engagementId filter requires an agency-managed tenant (tenant has no agencyId)",
      );
    }
    const engagement = await db.engagement.findFirst({
      where: { id: engagementId, agencyId: tenant.agencyId },
      select: { clientName: true },
    });
    if (!engagement) {
      throw new Error(
        `Engagement ${engagementId} not found for this tenant's agency`,
      );
    }
    engagementClientName = engagement.clientName;
  }

  let monthFilter: { gte: Date; lt: Date } | undefined;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`Invalid FILING_MONTH "${month}" — expected YYYY-MM`);
    }
    const [year, mon] = month.split("-").map(Number) as [number, number];
    monthFilter = {
      gte: new Date(Date.UTC(year, mon - 1, 1)),
      lt:  new Date(Date.UTC(year, mon, 1)),
    };
  }

  const drafts = await db.draftMcr.findMany({
    where: {
      meeting: {
        tenantId,
        ...(monthFilter ? { startAt: monthFilter } : {}),
        // Anti-over-reporting: only human-confirmed attributions ever submit.
        ...(engagementId
          ? { engagementId, engagementSource: { in: ["confirmed", "manual"] } }
          : {}),
      },
      certifiedAt: { not: null },
      submittedAt: null,
    },
    select: {
      id: true,
      subjects: true,
      meeting: {
        select: {
          startAt: true,
          attendees: {
            select: {
              isDpoh: true,
              resolvedOfficialId: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  const payloads: LrsSubmissionPayload[] = [];

  for (const draft of drafts) {
    const communicationDate = draft.meeting.startAt.toISOString().slice(0, 10);

    // ── Resolve DPOHs ──────────────────────────────────────────────────────────
    const dpohAttendees = draft.meeting.attendees.filter((a) => a.isDpoh === true);

    const dpohs: LrsDpoh[] = [];
    for (const attendee of dpohAttendees) {
      if (!attendee.resolvedOfficialId) {
        // No linked PublicOfficial — use the attendee name directly, no institution context
        const { firstName, lastName } = splitName(attendee.name);
        dpohs.push({
          firstName,
          lastName,
          positionTitle: "",
          governmentInstitution: "",
        });
        continue;
      }

      const official = await db.publicOfficial.findUnique({
        where: { id: attendee.resolvedOfficialId },
        select: {
          name: true,
          role: true,
          institution: { select: { name: true, acronym: true } },
        },
      });

      if (!official) continue;

      const { firstName, lastName } = splitName(official.name);
      dpohs.push({
        firstName,
        lastName,
        positionTitle: official.role,
        governmentInstitution: formatInstitutionLabel(
          official.institution.name,
          official.institution.acronym,
        ),
      });
    }

    // ── Subject details ────────────────────────────────────────────────────────
    // Phase 4: select ALL subjects from the DraftMcr.subjects Json field.
    // The subjects Json is [{ oclCode, source }] or [{ subjectId, source }].
    // For now, treat each entry as selected:true with a placeholder detailText.
    // In Phase 5, match against the registration's checkbox list by OCL code.
    const rawSubjects = draft.subjects as Array<{ oclCode?: number; subjectId?: string; source: string }>;
    const subjectDetails: LrsSubjectDetail[] = rawSubjects.map((s) => ({
      detailText: String(s.oclCode ?? s.subjectId ?? ""),
      selected: true,
    }));

    payloads.push({
      draftMcrId: draft.id,
      communicationDate,
      dpohs,
      subjectDetails,
      clientName: engagementClientName ?? tenant.name,
    });
  }

  return payloads;
}
