/**
 * src/server/filing-engine/consultant-batches.ts
 *
 * Groups an agency-own tenant's DraftMcrs into per-consultant, per-undertaking
 * certification batches. A consultant lobbyist certifies their own MCRs per
 * client undertaking (registration), so the monthly batch is keyed by
 * (consultantMemberId, engagementId) — not tenant-wide like in-house filing.
 *
 * Anti-over-reporting (non-negotiable #5): only meetings whose attribution a
 * human confirmed (engagementSource "confirmed" | "manual") are batched.
 * Auto-suggested attributions never reach a filing batch.
 */

import { db } from "@/lib/db";

/** Attribution sources that a human has signed off on. */
export const CONFIRMED_ENGAGEMENT_SOURCES = ["confirmed", "manual"] as const;

export interface ConsultantBatchDraft {
  draftMcrId: string;
  meetingId: string;
  meetingTitle: string;
  meetingStartAt: Date;
  certifiedAt: Date | null;
  submittedAt: Date | null;
}

export interface ConsultantBatch {
  /** Stable grouping key: `${consultantMemberId ?? "unassigned"}:${engagementId}`. */
  key: string;
  engagementId: string;
  clientName: string;
  registrationNum: string | null;
  consultantMemberId: string | null;
  consultantName: string | null;
  consultantEmail: string | null;
  consultantClerkUserId: string | null;
  drafts: ConsultantBatchDraft[];
  uncertifiedCount: number;
  certifiedCount: number;
  submittedCount: number;
}

function monthRange(month: string): { gte: Date; lt: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month "${month}" — expected YYYY-MM`);
  }
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return {
    gte: new Date(Date.UTC(year, mon - 1, 1)),
    lt: new Date(Date.UTC(year, mon, 1)),
  };
}

/**
 * Returns the consultant certification batches for one calendar month.
 * Empty array when the tenant is not an agency-own tenant (in-house tenants
 * keep the single tenant-wide batch).
 */
export async function getConsultantBatches(
  tenantId: string,
  month: string,
): Promise<ConsultantBatch[]> {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { agencyId: true, isAgencyOwnTenant: true },
  });
  if (!tenant.agencyId || !tenant.isAgencyOwnTenant) return [];

  const range = monthRange(month);

  const drafts = await db.draftMcr.findMany({
    where: {
      meeting: {
        tenantId,
        classification: "lobbying",
        startAt: range,
        engagementId: { not: null },
        engagementSource: { in: [...CONFIRMED_ENGAGEMENT_SOURCES] },
      },
    },
    select: {
      id: true,
      certifiedAt: true,
      submittedAt: true,
      meeting: {
        select: {
          id: true,
          title: true,
          startAt: true,
          engagement: {
            select: {
              id: true,
              clientName: true,
              registrationNum: true,
              consultantMemberId: true,
              consultantMember: {
                select: { name: true, email: true, clerkUserId: true },
              },
            },
          },
        },
      },
    },
    orderBy: { meeting: { startAt: "asc" } },
  });

  const batches = new Map<string, ConsultantBatch>();

  for (const d of drafts) {
    const engagement = d.meeting.engagement;
    if (!engagement) continue; // engagementId was non-null in the filter; belt only

    const key = `${engagement.consultantMemberId ?? "unassigned"}:${engagement.id}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        key,
        engagementId: engagement.id,
        clientName: engagement.clientName,
        registrationNum: engagement.registrationNum,
        consultantMemberId: engagement.consultantMemberId,
        consultantName: engagement.consultantMember?.name ?? null,
        consultantEmail: engagement.consultantMember?.email ?? null,
        consultantClerkUserId: engagement.consultantMember?.clerkUserId ?? null,
        drafts: [],
        uncertifiedCount: 0,
        certifiedCount: 0,
        submittedCount: 0,
      };
      batches.set(key, batch);
    }

    batch.drafts.push({
      draftMcrId: d.id,
      meetingId: d.meeting.id,
      meetingTitle: d.meeting.title,
      meetingStartAt: d.meeting.startAt,
      certifiedAt: d.certifiedAt,
      submittedAt: d.submittedAt,
    });
    if (d.submittedAt) batch.submittedCount++;
    else if (d.certifiedAt) batch.certifiedCount++;
    else batch.uncertifiedCount++;
  }

  return [...batches.values()].sort((a, b) =>
    a.clientName.localeCompare(b.clientName),
  );
}
