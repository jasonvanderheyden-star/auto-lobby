"use server";

/**
 * Server actions for consultant meeting→client attribution and per-undertaking
 * certification on agency-own tenants.
 *
 * - confirmEngagementAction: reviewer confirms (or reassigns) the client
 *   engagement a meeting belongs to. Only confirmed/manual attributions ever
 *   reach a filing batch (anti-over-reporting, non-negotiable #5).
 * - certifyConsultantBatchAction: the consultant of record — and only them —
 *   certifies their own undertaking's confirmed drafts for a month
 *   (non-negotiable #1 applied to consultant filing: the registrant for the
 *   undertaking personally attests).
 */

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/server/audit-log/append";
import { CONFIRMED_ENGAGEMENT_SOURCES } from "@/server/filing-engine/consultant-batches";
import { getTenantContext, type TenantContext } from "@/server/tenant/context";
import {
  auditActorRole,
  ForbiddenError,
  requireReviewer,
} from "@/server/tenant/roles";

const confirmSchema = z.object({
  meetingId: z.string().min(1),
  engagementId: z.string().min(1),
});

const certifySchema = z.object({
  engagementId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM"),
});

/** Loads the tenant and asserts it is an agency-own tenant; returns agencyId. */
async function requireAgencyOwnTenant(ctx: TenantContext): Promise<string> {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { agencyId: true, isAgencyOwnTenant: true },
  });
  if (!tenant.agencyId || !tenant.isAgencyOwnTenant) {
    throw new ForbiddenError(
      "Client attribution is only available on an agency's own tenant",
    );
  }
  return tenant.agencyId;
}

export async function confirmEngagementAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  requireReviewer(ctx);

  const { meetingId, engagementId } = confirmSchema.parse({
    meetingId: formData.get("meetingId"),
    engagementId: formData.get("engagementId"),
  });

  const agencyId = await requireAgencyOwnTenant(ctx);

  const meeting = await db.detectedMeeting.findFirst({
    where: { id: meetingId, tenantId: ctx.tenantId },
    select: {
      id: true,
      engagementId: true,
      engagementSource: true,
      engagementConfidence: true,
    },
  });
  if (!meeting) throw new Error("Meeting not found");

  const engagement = await db.engagement.findFirst({
    where: { id: engagementId, agencyId, status: "active" },
    select: { id: true, clientName: true },
  });
  if (!engagement) throw new Error("Engagement not found or not active");

  // Same engagement as the auto-suggestion → "confirmed" (keep the engine's
  // confidence). A different engagement → "manual" reassignment by a human
  // (confidence 1.0 — it is no longer an inference).
  const isSameAsSuggestion = meeting.engagementId === engagementId;
  const source = isSameAsSuggestion ? "confirmed" : "manual";
  const isReassignment =
    meeting.engagementId !== null && meeting.engagementId !== engagementId;

  await db.detectedMeeting.updateMany({
    where: { id: meetingId, tenantId: ctx.tenantId },
    data: {
      engagementId,
      engagementSource: source,
      engagementConfidence: isSameAsSuggestion
        ? (meeting.engagementConfidence ?? 1.0)
        : 1.0,
    },
  });

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: auditActorRole(ctx),
    onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
    action: isReassignment ? "engagement-reassigned" : "engagement-confirmed",
    subject: meetingId,
    payload: {
      engagementId,
      clientName: engagement.clientName,
      source,
      previousEngagementId: meeting.engagementId,
      previousSource: meeting.engagementSource,
      previousConfidence: meeting.engagementConfidence,
    },
  });

  revalidatePath("/filings");
}

export async function certifyConsultantBatchAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  const { engagementId, month } = certifySchema.parse({
    engagementId: formData.get("engagementId"),
    month: formData.get("month"),
  });

  const agencyId = await requireAgencyOwnTenant(ctx);

  // Non-negotiable #1 for consultant filing: the certifier must be the
  // AgencyMember (role "consultant") who is the registrant of record for this
  // undertaking — matched on their own authenticated Clerk user id.
  const engagement = await db.engagement.findFirst({
    where: { id: engagementId, agencyId },
    select: {
      id: true,
      clientName: true,
      registrationNum: true,
      status: true,
      consultantMember: {
        select: { id: true, clerkUserId: true, role: true },
      },
    },
  });
  if (!engagement) throw new Error("Engagement not found");
  if (
    !engagement.consultantMember ||
    engagement.consultantMember.role !== "consultant" ||
    engagement.consultantMember.clerkUserId !== ctx.userId
  ) {
    throw new ForbiddenError(
      "Only the consultant of record for this undertaking can certify its batch",
    );
  }

  const [year, mon] = month.split("-").map(Number) as [number, number];
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 1)); // exclusive

  // Only this undertaking's HUMAN-CONFIRMED lobbying drafts for the month.
  // Auto-suggested attributions never certify (anti-over-reporting).
  const drafts = await db.draftMcr.findMany({
    where: {
      meeting: {
        tenantId: ctx.tenantId,
        classification: "lobbying",
        startAt: { gte: monthStart, lt: monthEnd },
        engagementId,
        engagementSource: { in: [...CONFIRMED_ENGAGEMENT_SOURCES] },
      },
      certifiedAt: null,
    },
    select: { id: true },
  });

  if (drafts.length === 0) {
    revalidatePath("/filings");
    return;
  }

  await db.draftMcr.updateMany({
    where: { id: { in: drafts.map((d) => d.id) } },
    data: { certifiedAt: new Date(), certifiedByUserId: ctx.userId },
  });

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: "consultant",
    action: "batch-certified",
    subject: engagementId,
    payload: {
      engagementId,
      clientName: engagement.clientName,
      registrationNum: engagement.registrationNum,
      month,
      count: drafts.length,
      draftMcrIds: drafts.map((d) => d.id),
      nextStep: `Run TENANT_ID=<id> FILING_MONTH=${month} ENGAGEMENT_ID=${engagementId} npm run lrs:submit`,
    },
  });

  revalidatePath("/filings");
}
