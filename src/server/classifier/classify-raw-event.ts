import { db } from "@/lib/db";
import {
  resolveAttendee,
  resolveAttendees,
  type ResolverContext,
} from "@/server/dpoh-registry/resolve-attendee";
import { suggestEngagement } from "@/server/engagements/suggest-engagement";
import { classifyMeeting, type ClassificationResult } from "./classify-meeting";

export interface ClassifyEventResult {
  detectedMeetingId: string;
  verdict: ClassificationResult["verdict"];
  confidence: number;
  hadDpoh: boolean;
  reasonCount: number;
  attendeeCount: number;
}

/**
 * Classify a single RawCalendarEvent. Idempotent — re-running replaces
 * the existing DetectedMeeting row's reasons + attendees cleanly.
 *
 * Pass a pre-built `ctx` to avoid rebuilding the resolver context on every
 * call (important for backfill loops — build once with buildResolverContext,
 * then pass it through for all events in the batch).
 */
export async function classifyRawEvent(
  rawEventId: string,
  ctx?: ResolverContext,
): Promise<ClassifyEventResult> {
  const event = await db.rawCalendarEvent.findUniqueOrThrow({
    where: { id: rawEventId },
    select: {
      id: true,
      tenantId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      attendees: true,
      tenant: { select: { agencyId: true, isAgencyOwnTenant: true } },
    },
  });

  const attendeesArr = event.attendees as Array<{
    email: string | null;
    displayName: string | null;
  }>;
  const resolutions = ctx
    ? await Promise.all(attendeesArr.map((a) => resolveAttendee(a, ctx)))
    : await resolveAttendees(event.tenantId, attendeesArr);

  const result = classifyMeeting(
    { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt },
    resolutions,
  );

  // Pick employeeEmail (first internal) and institutionId (highest-priority gov)
  const employeeEmail = resolutions.find((r) => r.isInternal)?.email ?? "unknown@unknown";
  const institutionId =
    resolutions.find((r) => r.signal === "gov-with-named-dpoh")?.institutionId ??
    resolutions.find((r) => r.signal === "gov-attendee-unknown-role")?.institutionId ??
    resolutions.find((r) => r.institutionId)?.institutionId ??
    null;

  const detected = await db.$transaction(async (tx) => {
    // Wipe prior reasons + attendees if this event was previously classified
    const existing = await tx.detectedMeeting.findUnique({ where: { rawEventId } });
    if (existing) {
      await tx.classificationReason.deleteMany({ where: { meetingId: existing.id } });
      await tx.meetingAttendee.deleteMany({ where: { meetingId: existing.id } });
    }

    const meeting = await tx.detectedMeeting.upsert({
      where: { rawEventId },
      create: {
        tenantId: event.tenantId,
        rawEventId,
        title: event.title ?? "(no title)",
        startAt: event.startsAt ?? new Date(),
        endAt: event.endsAt ?? new Date(),
        employeeEmail,
        institutionId,
        hadDpoh: result.hadDpoh,
        classification: result.verdict,
        classificationConfidence: result.confidence,
        status: result.verdict === "needs-info" ? "needs-info" : "auto-drafted",
      },
      update: {
        title: event.title ?? "(no title)",
        startAt: event.startsAt ?? new Date(),
        endAt: event.endsAt ?? new Date(),
        employeeEmail,
        institutionId,
        hadDpoh: result.hadDpoh,
        classification: result.verdict,
        classificationConfidence: result.confidence,
        status: result.verdict === "needs-info" ? "needs-info" : "auto-drafted",
      },
    });

    if (result.reasons.length > 0) {
      await tx.classificationReason.createMany({
        data: result.reasons.map((r) => ({
          meetingId: meeting.id,
          ok: r.ok,
          text: r.text,
          citation: r.citation,
          weight: r.weight,
        })),
      });
    }

    const attendeeRows = resolutions
      .filter((r) => r.email)
      .map((r) => ({
        meetingId: meeting.id,
        name: r.displayName ?? r.email ?? "(unknown)",
        email: r.email!,
        resolvedOfficialId: r.resolvedOfficialId,
        isInternal: r.isInternal,
        isDpoh: r.isDpoh,
      }));
    if (attendeeRows.length > 0) {
      await tx.meetingAttendee.createMany({ data: attendeeRows });
    }

    return { meetingId: meeting.id, attendeeCount: attendeeRows.length };
  });

  // Consultant meeting→client attribution (agency-own tenants only).
  // Cheap gate: tenant fields were fetched with the event — in-house tenants
  // (no agencyId) never trigger the extra queries. Confirmed/manual
  // attributions are never overwritten (handled inside suggestEngagement).
  if (
    (result.verdict === "lobbying" || result.verdict === "needs-info") &&
    event.tenant.agencyId &&
    event.tenant.isAgencyOwnTenant
  ) {
    await suggestEngagement(detected.meetingId);
  }

  return {
    detectedMeetingId: detected.meetingId,
    verdict: result.verdict,
    confidence: result.confidence,
    hadDpoh: result.hadDpoh,
    reasonCount: result.reasons.length,
    attendeeCount: detected.attendeeCount,
  };
}
