"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getTenantContext } from "@/server/tenant/context";
import {
  auditActorRole,
  requireCertifier,
  requireReviewer,
} from "@/server/tenant/roles";
import { classifyRawEvent } from "@/server/classifier/classify-raw-event";
import { generateDraftMcr } from "@/server/filing-engine/generate-draft-mcr";
import { buildResolverContext } from "@/server/dpoh-registry/resolve-attendee";
import { appendAuditEvent } from "@/server/audit-log/append";

export async function confirmDpohAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  requireReviewer(ctx);

  const meetingId = formData.get("meetingId");
  const attendeeEmail = formData.get("attendeeEmail");
  if (typeof meetingId !== "string" || typeof attendeeEmail !== "string") {
    throw new Error("Missing meetingId or attendeeEmail");
  }

  // Find attendee + institution context
  const attendee = await db.meetingAttendee.findFirst({
    where: {
      meeting: { id: meetingId, tenantId: ctx.tenantId },
      email: attendeeEmail,
    },
    include: { meeting: { select: { institutionId: true } } },
  });
  if (!attendee) throw new Error("Attendee not found");
  if (!attendee.meeting.institutionId) throw new Error("Meeting has no institution");

  // Write or update PublicOfficial — high confidence, user-confirmed
  let officialId: string;
  const existing = await db.publicOfficial.findFirst({
    where: {
      name: { equals: attendee.name, mode: "insensitive" },
      institutionId: attendee.meeting.institutionId,
    },
  });
  if (existing) {
    await db.publicOfficial.update({
      where: { id: existing.id },
      data: {
        email: attendeeEmail,
        isDpoh: true,
        dpohBasis: "role",
        ruleRef: "User-confirmed DPOH",
        resolvedFrom: "manual",
        confidence: 1.0,
      },
    });
    officialId = existing.id;
  } else {
    const created = await db.publicOfficial.create({
      data: {
        name: attendee.name,
        email: attendeeEmail,
        institutionId: attendee.meeting.institutionId,
        role: "Confirmed by user",
        isDpoh: true,
        dpohBasis: "role",
        ruleRef: "User-confirmed DPOH",
        resolvedFrom: "manual",
        confidence: 1.0,
        effectiveFrom: new Date(),
      },
    });
    officialId = created.id;
  }

  // Cascade: find every DetectedMeeting where this email appears, re-classify each
  const affected = await db.detectedMeeting.findMany({
    where: {
      tenantId: ctx.tenantId,
      attendees: { some: { email: attendeeEmail } },
    },
    select: { id: true, rawEventId: true },
  });

  const resolverCtx = await buildResolverContext(ctx.tenantId);
  for (const m of affected) {
    await classifyRawEvent(m.rawEventId, resolverCtx);
    await generateDraftMcr(m.id);
  }

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: auditActorRole(ctx),
    onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
    action: "dpoh-confirmed",
    subject: officialId,
    payload: { meetingId, attendeeEmail, affectedMeetings: affected.length },
  });

  revalidatePath("/filings");
}

export async function excludeMeetingAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  requireReviewer(ctx);

  const meetingId = formData.get("meetingId");
  const attendeeEmail = formData.get("attendeeEmail");
  if (typeof meetingId !== "string") throw new Error("Missing meetingId");

  const meeting = await db.detectedMeeting.findFirst({
    where: { id: meetingId, tenantId: ctx.tenantId },
    select: { id: true, classification: true, institutionId: true },
  });
  if (!meeting) throw new Error("Meeting not found");

  // If this is a lobbying row OR no attendeeEmail was given, just exclude this one meeting.
  if (meeting.classification === "lobbying" || typeof attendeeEmail !== "string" || !attendeeEmail) {
    await db.detectedMeeting.update({
      where: { id: meetingId },
      data: { status: "excluded" },
    });
    await db.draftMcr.deleteMany({ where: { meetingId } });
    await appendAuditEvent({
      tenantId: ctx.tenantId,
      actor: userId,
      actorRole: auditActorRole(ctx),
      onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
      action: "meeting-excluded",
      subject: meetingId,
      payload: { scope: "single", reason: "user-marked-not-lobbying" },
    });
    revalidatePath("/filings");
    return;
  }

  // Needs-info path: write a negative confirmation for the attendee, then cascade.
  const attendee = await db.meetingAttendee.findFirst({
    where: {
      meeting: { id: meetingId, tenantId: ctx.tenantId },
      email: attendeeEmail,
    },
  });
  if (!attendee) throw new Error("Attendee not found");
  if (!meeting.institutionId) throw new Error("Meeting has no institution");

  // Upsert PublicOfficial with isDpoh=false
  let officialId: string;
  const existing = await db.publicOfficial.findFirst({
    where: {
      name: { equals: attendee.name, mode: "insensitive" },
      institutionId: meeting.institutionId,
    },
  });
  if (existing) {
    await db.publicOfficial.update({
      where: { id: existing.id },
      data: {
        email: attendeeEmail,
        isDpoh: false,
        dpohBasis: null,
        ruleRef: "User-confirmed not a DPOH",
        resolvedFrom: "manual",
        confidence: 1.0,
      },
    });
    officialId = existing.id;
  } else {
    const created = await db.publicOfficial.create({
      data: {
        name: attendee.name,
        email: attendeeEmail,
        institutionId: meeting.institutionId,
        role: "User-marked not-DPOH",
        isDpoh: false,
        dpohBasis: null,
        ruleRef: "User-confirmed not a DPOH",
        resolvedFrom: "manual",
        confidence: 1.0,
        effectiveFrom: new Date(),
      },
    });
    officialId = created.id;
  }

  // Cascade: re-classify every meeting where this email appears
  const affected = await db.detectedMeeting.findMany({
    where: {
      tenantId: ctx.tenantId,
      attendees: { some: { email: attendeeEmail } },
    },
    select: { id: true, rawEventId: true },
  });

  const resolverCtx = await buildResolverContext(ctx.tenantId);
  for (const m of affected) {
    await classifyRawEvent(m.rawEventId, resolverCtx);
    // After reclassify, only generate DraftMcr if still needed; otherwise drop it
    const after = await db.detectedMeeting.findUniqueOrThrow({
      where: { id: m.id },
      select: { classification: true },
    });
    if (after.classification === "lobbying" || after.classification === "needs-info") {
      await generateDraftMcr(m.id);
    } else {
      await db.draftMcr.deleteMany({ where: { meetingId: m.id } });
    }
  }

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: auditActorRole(ctx),
    onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
    action: "non-dpoh-confirmed",
    subject: officialId,
    payload: { meetingId, attendeeEmail, affectedMeetings: affected.length },
  });

  revalidatePath("/filings");
}

export async function resetAttendeeAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  requireReviewer(ctx);

  const meetingId = formData.get("meetingId");
  const attendeeEmail = formData.get("attendeeEmail");
  if (typeof meetingId !== "string" || typeof attendeeEmail !== "string") {
    throw new Error("Missing meetingId or attendeeEmail");
  }

  const attendee = await db.meetingAttendee.findFirst({
    where: {
      meeting: { id: meetingId, tenantId: ctx.tenantId },
      email: attendeeEmail,
    },
    include: { meeting: { select: { institutionId: true } } },
  });
  if (!attendee || !attendee.meeting.institutionId) throw new Error("Attendee not found");

  const official = await db.publicOfficial.findFirst({
    where: {
      name: { equals: attendee.name, mode: "insensitive" },
      institutionId: attendee.meeting.institutionId,
    },
  });

  const officialId = official?.id ?? attendeeEmail;
  if (official && official.resolvedFrom === "manual") {
    // Reset undoes a manual confirm/exclude: remove the user-written row.
    // Registry-sourced rows (geds, parliament, ...) are left untouched —
    // isDpoh is non-nullable and their determination isn't ours to clear;
    // re-classification below re-resolves against the registry as-is.
    await db.publicOfficial.delete({ where: { id: official.id } });
  }

  const affected = await db.detectedMeeting.findMany({
    where: {
      tenantId: ctx.tenantId,
      attendees: { some: { email: attendeeEmail } },
    },
    select: { id: true, rawEventId: true },
  });

  const resolverCtx = await buildResolverContext(ctx.tenantId);
  for (const m of affected) {
    await classifyRawEvent(m.rawEventId, resolverCtx);
    await generateDraftMcr(m.id);
  }

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: auditActorRole(ctx),
    onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
    action: "dpoh-reset",
    subject: officialId,
    payload: { meetingId, attendeeEmail, affectedMeetings: affected.length },
  });

  revalidatePath("/filings");
}

export async function certifyBatchAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  // Non-negotiable #1: only the tenant's own Responsible Officer certifies.
  requireCertifier(ctx);

  // month is "YYYY-MM" — only certify MCRs whose meeting falls in that month
  const month = formData.get("month");
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Invalid or missing month parameter (expected YYYY-MM)");
  }

  const [year, mon] = month.split("-").map(Number) as [number, number];
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd   = new Date(Date.UTC(year, mon, 1)); // exclusive

  const drafts = await db.draftMcr.findMany({
    where: {
      meeting: {
        tenantId: ctx.tenantId,
        classification: "lobbying",
        startAt: { gte: monthStart, lt: monthEnd },
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
    data: { certifiedAt: new Date() },
  });

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: auditActorRole(ctx),
    onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
    action: "batch-certified",
    subject: ctx.tenantId,
    payload: {
      month,
      count: drafts.length,
      draftMcrIds: drafts.map((d) => d.id),
      nextStep: `Run TENANT_ID=<id> FILING_MONTH=${month} npm run lrs:submit`,
    },
  });

  revalidatePath("/filings");
}
